#!/usr/bin/env npx tsx
/**
 * Registry Sync Script
 *
 * Synchronizes dojo-skills registry with external sources:
 * - Skills from Chat2AnyLLM/awesome-claude-skills
 * - MCPs from Chat2AnyLLM/code-assistant-manager
 *
 * Features:
 * - Fetches and parses markdown tables for skills
 * - Fetches JSON files for MCP server configs
 * - Validates URLs and filters broken links
 * - Converts to dojo-skills registry schema
 * - Deduplicates and merges with existing registry
 */

import * as fs from "fs/promises";
import * as path from "path";

// Configuration
const CONFIG = {
  awesomeSkillsRepo: {
    owner: "Chat2AnyLLM",
    repo: "awesome-claude-skills",
    branch: "main",
    domainsPath: "domains",
  },
  mcpManagerRepo: {
    owner: "Chat2AnyLLM",
    repo: "code-assistant-manager",
    branch: "main",
    serversPath: "code_assistant_manager/mcp/registry/servers",
  },
  outputDir: path.join(import.meta.dirname, "..", "registry"),
  urlValidationTimeout: 5000,
  maxConcurrentRequests: 10,
  dryRun: process.argv.includes("--dry-run"),
  verbose: process.argv.includes("--verbose"),
  validateUrls: process.argv.includes("--validate"),
};

// Types for dojo-skills registry schema
interface DojoSkill {
  name: string;
  source: string;
  aliases?: string[];
  description: string;
  tags: string[];
  dependencies?: string[];
  versions: { latest: string };
  mcp_servers?: McpServerConfig[];
}

interface McpServerConfig {
  name: string;
  package?: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface RegistryFile {
  skills: Record<string, DojoSkill>;
}

interface IndexJson {
  version: string;
  updated: string;
  format: string;
  compatibleWith: string[];
  totalSkills: number;
  categories: {
    official: string[];
    community: string[];
    mcp: string[];
    cursor: string[];
  };
}

// Logging utilities
function log(message: string, level: "info" | "warn" | "error" = "info") {
  const prefix = {
    info: "ℹ️ ",
    warn: "⚠️ ",
    error: "❌",
  }[level];
  console.log(`${prefix} ${message}`);
}

function verbose(message: string) {
  if (CONFIG.verbose) {
    console.log(`   ${message}`);
  }
}

// URL validation with retry and better GitHub handling
async function validateUrl(url: string): Promise<boolean> {
  // Skip validation if flag is not set - validation is opt-in due to rate limits
  if (!CONFIG.validateUrls) {
    return true;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    CONFIG.urlValidationTimeout
  );

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // Use GET instead of HEAD - some servers don't support HEAD properly
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": "dojo-skills-sync/1.0",
        },
      });
      clearTimeout(timeout);
      // Accept 2xx and 3xx as valid
      return response.status < 400;
    } catch {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 1000)); // Longer delay between retries
      }
    }
  }
  clearTimeout(timeout);
  return false;
}

// Batch URL validation with concurrency control
async function validateUrlsBatch(
  entries: Array<{ key: string; url: string }>
): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();
  const queue = [...entries];
  const active: Promise<void>[] = [];

  while (queue.length > 0 || active.length > 0) {
    while (active.length < CONFIG.maxConcurrentRequests && queue.length > 0) {
      const entry = queue.shift()!;
      const promise = validateUrl(entry.url)
        .then((valid) => {
          results.set(entry.key, valid);
          if (!valid) {
            verbose(`  ✗ Broken: ${entry.url}`);
          }
        })
        .then(() => {
          const idx = active.indexOf(promise);
          if (idx > -1) active.splice(idx, 1);
        });
      active.push(promise);
    }
    if (active.length > 0) {
      await Promise.race(active);
    }
  }
  return results;
}

// Fetch GitHub directory listing
async function fetchGitHubDirectory(
  owner: string,
  repo: string,
  path: string,
  branch = "main"
): Promise<Array<{ name: string; download_url: string; type: string }>> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} for ${url}`);
  }
  return response.json();
}

// Parse markdown table from awesome-claude-skills domains
function parseSkillsMarkdown(
  markdown: string,
  domain: string
): Array<{ name: string; url: string; description: string; author: string }> {
  const skills: Array<{
    name: string;
    url: string;
    description: string;
    author: string;
  }> = [];

  // Look for table rows: | [name](url) | description | author |
  const tableRowRegex =
    /\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g;
  let match;

  while ((match = tableRowRegex.exec(markdown)) !== null) {
    const [, name, url, description, author] = match;
    if (name && url && !url.includes("img.shields.io")) {
      skills.push({
        name: name.trim(),
        url: url.trim(),
        description: description.trim(),
        author: author.trim(),
      });
    }
  }

  return skills;
}

// Convert GitHub URL to our source format
function urlToSource(url: string): string {
  // Convert https://github.com/owner/repo/tree/branch/path to github:owner/repo/path
  const match = url.match(
    /github\.com\/([^/]+)\/([^/]+)(?:\/tree\/[^/]+)?(?:\/(.+))?/
  );
  if (match) {
    const [, owner, repo, pathPart] = match;
    if (pathPart) {
      return `github:${owner}/${repo}/${pathPart}`;
    }
    return `github:${owner}/${repo}`;
  }
  return url;
}

// Normalize skill name to key format
function nameToKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Fetch and parse skills from awesome-claude-skills
async function fetchSkillsFromAwesome(): Promise<Map<string, DojoSkill>> {
  log("Fetching skills from awesome-claude-skills...");
  const skills = new Map<string, DojoSkill>();

  try {
    const { owner, repo, branch, domainsPath } = CONFIG.awesomeSkillsRepo;
    const files = await fetchGitHubDirectory(owner, repo, domainsPath, branch);

    for (const file of files) {
      if (!file.name.endsWith(".md") || file.type !== "file") continue;

      verbose(`  Processing ${file.name}...`);
      const response = await fetch(file.download_url);
      if (!response.ok) continue;

      const markdown = await response.text();
      const domain = file.name.replace(".md", "").replace(/-/g, " ");
      const domainTag = file.name.replace(".md", "");
      const parsed = parseSkillsMarkdown(markdown, domain);

      for (const skill of parsed) {
        const key = nameToKey(skill.name);
        if (!skills.has(key)) {
          skills.set(key, {
            name: skill.name,
            source: urlToSource(skill.url),
            description:
              skill.description.length > 200
                ? skill.description.substring(0, 197) + "..."
                : skill.description,
            tags: [domainTag, "community"],
            versions: { latest: "main" },
          });
        }
      }

      verbose(`    Found ${parsed.length} skills in ${file.name}`);
    }

    log(`Found ${skills.size} total skills from awesome-claude-skills`);
  } catch (error) {
    log(`Error fetching skills: ${error}`, "error");
  }

  return skills;
}

// Fetch and parse MCPs from code-assistant-manager
async function fetchMcpsFromManager(): Promise<Map<string, DojoSkill>> {
  log("Fetching MCPs from code-assistant-manager...");
  const mcps = new Map<string, DojoSkill>();

  try {
    const { owner, repo, branch, serversPath } = CONFIG.mcpManagerRepo;
    const files = await fetchGitHubDirectory(owner, repo, serversPath, branch);

    let processed = 0;
    for (const file of files) {
      if (!file.name.endsWith(".json") || file.type !== "file") continue;

      try {
        const response = await fetch(file.download_url);
        if (!response.ok) continue;

        const data = await response.json();

        const key = file.name.replace(".json", "");
        const repoUrl = data.repository?.url || data.homepage || "";

        // Build MCP server config from installations
        const mcpServers: McpServerConfig[] = [];
        if (data.installations) {
          for (const [installType, config] of Object.entries(
            data.installations
          ) as [string, any][]) {
            if (config.command && config.args) {
              mcpServers.push({
                name: `${data.name || key}-${installType}`,
                command: config.command,
                args: config.args,
                env: config.env || {},
              });
            }
          }
        }

        mcps.set(key, {
          name: data.display_name || data.name || key,
          source: urlToSource(repoUrl),
          description: data.description || `${key} MCP server`,
          tags: ["mcp", ...(data.tags || []), ...(data.categories || [])],
          versions: { latest: "main" },
          ...(mcpServers.length > 0 && { mcp_servers: mcpServers }),
        });

        processed++;
        if (processed % 50 === 0) {
          verbose(`  Processed ${processed} MCP files...`);
        }
      } catch {
        verbose(`  ✗ Failed to parse ${file.name}`);
      }
    }

    log(`Found ${mcps.size} total MCPs from code-assistant-manager`);
  } catch (error) {
    log(`Error fetching MCPs: ${error}`, "error");
  }

  return mcps;
}

// Validate and filter entries with broken links
async function filterBrokenLinks(
  skills: Map<string, DojoSkill>,
  label: string
): Promise<Map<string, DojoSkill>> {
  log(`Validating ${skills.size} ${label} URLs...`);

  const entries = Array.from(skills.entries()).map(([key, skill]) => {
    // Convert source to URL for validation
    let url = skill.source;
    if (url.startsWith("github:")) {
      url = `https://github.com/${url.replace("github:", "")}`;
    }
    return { key, url };
  });

  const validationResults = await validateUrlsBatch(entries);

  const filtered = new Map<string, DojoSkill>();
  let brokenCount = 0;

  for (const [key, skill] of skills) {
    if (validationResults.get(key) !== false) {
      filtered.set(key, skill);
    } else {
      brokenCount++;
    }
  }

  log(
    `Filtered out ${brokenCount} broken links, ${filtered.size} ${label} remain`
  );
  return filtered;
}

// Load existing registry files
async function loadExistingRegistry(
  filePath: string
): Promise<RegistryFile | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// Merge new skills with existing, deduplicate by source
function mergeSkills(
  existing: Map<string, DojoSkill>,
  newSkills: Map<string, DojoSkill>
): Map<string, DojoSkill> {
  const merged = new Map(existing);
  const sourcesSeen = new Set(Array.from(existing.values()).map((s) => s.source));

  for (const [key, skill] of newSkills) {
    if (!sourcesSeen.has(skill.source)) {
      merged.set(key, skill);
      sourcesSeen.add(skill.source);
    }
  }

  return merged;
}

// Write registry file
async function writeRegistryFile(
  filePath: string,
  skills: Map<string, DojoSkill>
): Promise<void> {
  const registry: RegistryFile = {
    skills: Object.fromEntries(skills),
  };

  if (CONFIG.dryRun) {
    log(`[DRY RUN] Would write ${skills.size} entries to ${filePath}`);
    return;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(registry, null, 2) + "\n");
  log(`Wrote ${skills.size} entries to ${filePath}`);
}

// Update index.json
async function updateIndex(
  skillCount: number,
  mcpCount: number
): Promise<void> {
  const indexPath = path.join(CONFIG.outputDir, "index.json");

  try {
    const content = await fs.readFile(indexPath, "utf-8");
    const index: IndexJson = JSON.parse(content);

    // Add new files to categories if not present
    if (!index.categories.community.includes("synced-awesome.json")) {
      index.categories.community.push("synced-awesome.json");
    }
    if (!index.categories.mcp.includes("synced-mcps.json")) {
      index.categories.mcp.push("synced-mcps.json");
    }

    // Update counts and date
    index.totalSkills = skillCount + mcpCount;
    index.updated = new Date().toISOString().split("T")[0];

    if (CONFIG.dryRun) {
      log(
        `[DRY RUN] Would update index.json with ${index.totalSkills} total skills`
      );
      return;
    }

    await fs.writeFile(indexPath, JSON.stringify(index, null, 2) + "\n");
    log(`Updated index.json: ${index.totalSkills} total skills`);
  } catch (error) {
    log(`Error updating index.json: ${error}`, "error");
  }
}

// Main execution
async function main() {
  log("=== Registry Sync Script ===");
  if (CONFIG.dryRun) {
    log("Running in DRY RUN mode - no files will be written");
  }

  // Fetch from external sources
  const awesomeSkills = await fetchSkillsFromAwesome();
  const managerMcps = await fetchMcpsFromManager();

  // Validate URLs and filter broken links
  const validSkills = await filterBrokenLinks(awesomeSkills, "skills");
  const validMcps = await filterBrokenLinks(managerMcps, "MCPs");

  // Load existing synced files if present
  const existingSkillsPath = path.join(
    CONFIG.outputDir,
    "community",
    "synced-awesome.json"
  );
  const existingMcpsPath = path.join(
    CONFIG.outputDir,
    "mcp",
    "synced-mcps.json"
  );

  const existingSkillsFile = await loadExistingRegistry(existingSkillsPath);
  const existingMcpsFile = await loadExistingRegistry(existingMcpsPath);

  const existingSkills = existingSkillsFile
    ? new Map(Object.entries(existingSkillsFile.skills))
    : new Map<string, DojoSkill>();
  const existingMcps = existingMcpsFile
    ? new Map(Object.entries(existingMcpsFile.skills))
    : new Map<string, DojoSkill>();

  // Merge with existing
  const finalSkills = mergeSkills(existingSkills, validSkills);
  const finalMcps = mergeSkills(existingMcps, validMcps);

  // Write output files
  await writeRegistryFile(existingSkillsPath, finalSkills);
  await writeRegistryFile(existingMcpsPath, finalMcps);

  // Update index
  await updateIndex(finalSkills.size, finalMcps.size);

  log("=== Sync Complete ===");
  log(`Skills: ${finalSkills.size} | MCPs: ${finalMcps.size}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
