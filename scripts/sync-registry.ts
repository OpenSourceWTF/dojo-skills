#!/usr/bin/env npx tsx
/**
 * Registry Sync Script
 *
 * Synchronizes dojo-skills registry with external sources:
 * - Skills from Chat2AnyLLM/awesome-claude-skills
 * - MCPs from Chat2AnyLLM/code-assistant-manager
 *
 * Features:
 * - Groups output by GitHub owner/author (like existing registry structure)
 * - Fetches and parses markdown tables for skills
 * - Fetches JSON files for MCP server configs
 * - Validates URLs and filters broken links (opt-in)
 * - Converts to dojo-skills registry schema
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
  // Minimum skills per author to create a separate file (1 = all authors get their own file)
  minSkillsPerFile: 1,
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
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": "dojo-skills-sync/1.0" },
      });
      clearTimeout(timeout);
      return response.status < 400;
    } catch {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 1000));
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
  dirPath: string,
  branch = "main"
): Promise<Array<{ name: string; download_url: string; type: string }>> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}?ref=${branch}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} for ${url}`);
  }
  return response.json();
}

// Parse markdown table from awesome-claude-skills domains
function parseSkillsMarkdown(
  markdown: string
): Array<{ name: string; url: string; description: string; author: string }> {
  const skills: Array<{
    name: string;
    url: string;
    description: string;
    author: string;
  }> = [];

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

// Extract owner from GitHub URL
function extractOwner(url: string): string {
  const match = url.match(/github\.com\/([^/]+)/);
  return match ? match[1].toLowerCase() : "unknown";
}

// Convert GitHub URL to our source format
function urlToSource(url: string): string {
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

// Group skills by owner
type SkillsByOwner = Map<string, Map<string, DojoSkill>>;

// Fetch and parse skills from awesome-claude-skills, grouped by owner
async function fetchSkillsFromAwesome(): Promise<SkillsByOwner> {
  log("Fetching skills from awesome-claude-skills...");
  const skillsByOwner: SkillsByOwner = new Map();

  try {
    const { owner, repo, branch, domainsPath } = CONFIG.awesomeSkillsRepo;
    const files = await fetchGitHubDirectory(owner, repo, domainsPath, branch);

    for (const file of files) {
      if (!file.name.endsWith(".md") || file.type !== "file") continue;

      verbose(`  Processing ${file.name}...`);
      const response = await fetch(file.download_url);
      if (!response.ok) continue;

      const markdown = await response.text();
      const domainTag = file.name.replace(".md", "");
      const parsed = parseSkillsMarkdown(markdown);

      for (const skill of parsed) {
        const ownerName = extractOwner(skill.url);
        const key = nameToKey(skill.name);

        if (!skillsByOwner.has(ownerName)) {
          skillsByOwner.set(ownerName, new Map());
        }

        const ownerSkills = skillsByOwner.get(ownerName)!;
        if (!ownerSkills.has(key)) {
          ownerSkills.set(key, {
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

    const totalSkills = Array.from(skillsByOwner.values()).reduce(
      (sum, m) => sum + m.size,
      0
    );
    log(
      `Found ${totalSkills} skills from ${skillsByOwner.size} authors`
    );
  } catch (error) {
    log(`Error fetching skills: ${error}`, "error");
  }

  return skillsByOwner;
}

// Fetch and parse MCPs from code-assistant-manager, grouped by owner
async function fetchMcpsFromManager(): Promise<SkillsByOwner> {
  log("Fetching MCPs from code-assistant-manager...");
  const mcpsByOwner: SkillsByOwner = new Map();

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
        const ownerName = extractOwner(repoUrl) || "unknown";

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

        if (!mcpsByOwner.has(ownerName)) {
          mcpsByOwner.set(ownerName, new Map());
        }

        mcpsByOwner.get(ownerName)!.set(key, {
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

    const totalMcps = Array.from(mcpsByOwner.values()).reduce(
      (sum, m) => sum + m.size,
      0
    );
    log(`Found ${totalMcps} MCPs from ${mcpsByOwner.size} authors`);
  } catch (error) {
    log(`Error fetching MCPs: ${error}`, "error");
  }

  return mcpsByOwner;
}

// Validate and filter entries with broken links
async function filterBrokenLinks(
  skillsByOwner: SkillsByOwner,
  label: string
): Promise<SkillsByOwner> {
  const allEntries: Array<{ key: string; url: string; owner: string }> = [];

  for (const [ownerName, skills] of skillsByOwner) {
    for (const [key, skill] of skills) {
      let url = skill.source;
      if (url.startsWith("github:")) {
        url = `https://github.com/${url.replace("github:", "")}`;
      }
      allEntries.push({ key: `${ownerName}:${key}`, url, owner: ownerName });
    }
  }

  log(`Validating ${allEntries.length} ${label} URLs...`);
  const validationResults = await validateUrlsBatch(allEntries);

  let brokenCount = 0;
  const filtered: SkillsByOwner = new Map();

  for (const [ownerName, skills] of skillsByOwner) {
    const validSkills = new Map<string, DojoSkill>();
    for (const [key, skill] of skills) {
      const fullKey = `${ownerName}:${key}`;
      if (validationResults.get(fullKey) !== false) {
        validSkills.set(key, skill);
      } else {
        brokenCount++;
      }
    }
    if (validSkills.size > 0) {
      filtered.set(ownerName, validSkills);
    }
  }

  log(
    `Filtered out ${brokenCount} broken links, ${filtered.size} authors remain`
  );
  return filtered;
}

// Write registry files grouped by owner
async function writeRegistryFiles(
  skillsByOwner: SkillsByOwner,
  category: "community" | "mcp"
): Promise<{ files: string[]; totalCount: number }> {
  const categoryDir = path.join(CONFIG.outputDir, category);
  const files: string[] = [];
  let totalCount = 0;

  // Collect small authors into "misc" file
  const miscSkills = new Map<string, DojoSkill>();

  for (const [ownerName, skills] of skillsByOwner) {
    if (skills.size < CONFIG.minSkillsPerFile) {
      // Add to misc
      for (const [key, skill] of skills) {
        miscSkills.set(`${ownerName}-${key}`, skill);
      }
    } else {
      // Write separate file for this owner
      const fileName = `${ownerName}.json`;
      const filePath = path.join(categoryDir, fileName);

      const registry: RegistryFile = {
        skills: Object.fromEntries(skills),
      };

      if (CONFIG.dryRun) {
        log(`[DRY RUN] Would write ${skills.size} entries to ${fileName}`);
      } else {
        await fs.mkdir(categoryDir, { recursive: true });
        await fs.writeFile(filePath, JSON.stringify(registry, null, 2) + "\n");
        verbose(`  Wrote ${skills.size} entries to ${fileName}`);
      }

      files.push(fileName);
      totalCount += skills.size;
    }
  }

  // Write misc file if there are any small-author skills
  if (miscSkills.size > 0) {
    const miscFileName = category === "mcp" ? "synced-misc.json" : "synced-misc.json";
    const miscPath = path.join(categoryDir, miscFileName);

    const registry: RegistryFile = {
      skills: Object.fromEntries(miscSkills),
    };

    if (CONFIG.dryRun) {
      log(`[DRY RUN] Would write ${miscSkills.size} misc entries to ${miscFileName}`);
    } else {
      await fs.mkdir(categoryDir, { recursive: true });
      await fs.writeFile(miscPath, JSON.stringify(registry, null, 2) + "\n");
      verbose(`  Wrote ${miscSkills.size} misc entries to ${miscFileName}`);
    }

    files.push(miscFileName);
    totalCount += miscSkills.size;
  }

  log(`${category}: ${files.length} files, ${totalCount} entries`);
  return { files, totalCount };
}

// Check if file exists asynchronously
async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.stat(path);
    return true;
  } catch {
    return false;
  }
}

// Update index.json with new files
async function updateIndex(
  communityFiles: string[],
  mcpFiles: string[],
  totalSkills: number
): Promise<void> {
  const indexPath = path.join(CONFIG.outputDir, "index.json");

  try {
    const content = await fs.readFile(indexPath, "utf-8");
    const index: IndexJson = JSON.parse(content);

    // Add new files to categories if not present, but verify existence first
    // Note: clean up index entries if file no longer exists?
    // For now, simpler: only ADD if not present.
    // Ideally we should sync index with exactly what was written + existing files.
    // The previous implementation pushes blindly.

    // Better: Rebuild category file lists from filesystem? 
    // No, we trust the sync logic. But we should check if they exist.
    // Actually, sync logic returns the files it WROTE.
    // But index contains *previously* written files too (if any were not overwritten).
    // Let's assume sync overwrites everything for its managed categories.
    // If files are removed (e.g. author removed skills), they might remain in FS but not in result.
    // That's a separate cleanup task.

    for (const file of communityFiles) {
      if (!index.categories.community.includes(file)) {
        index.categories.community.push(file);
      }
    }
    for (const file of mcpFiles) {
      if (!index.categories.mcp.includes(file)) {
        index.categories.mcp.push(file);
      }
    }

    // Cleanup: Filter out files that don't exist
    index.categories.community = await filterExistingFiles(CONFIG.outputDir, "community", index.categories.community);
    index.categories.mcp = await filterExistingFiles(CONFIG.outputDir, "mcp", index.categories.mcp);

    // Update counts and date
    index.totalSkills = totalSkills;
    index.updated = new Date().toISOString().split("T")[0];

    if (CONFIG.dryRun) {
      log(`[DRY RUN] Would update index.json with ${totalSkills} total skills`);
      log(`[DRY RUN] Community files: ${communityFiles.join(", ")}`);
      log(`[DRY RUN] MCP files: ${mcpFiles.join(", ")}`);
      return;
    }

    await fs.writeFile(indexPath, JSON.stringify(index, null, 2) + "\n");
    log(`Updated index.json: ${totalSkills} total skills`);
  } catch (error) {
    log(`Error updating index.json: ${error}`, "error");
  }
}

async function filterExistingFiles(baseDir: string, category: string, files: string[]): Promise<string[]> {
  const existing: string[] = [];
  for (const file of files) {
    const filePath = path.join(baseDir, category, file);
    if (await fileExists(filePath)) {
      existing.push(file);
    }
  }
  return existing;
}

// Run build script
async function runBuild() {
  log("Running registry build...");
  const buildScript = path.join(import.meta.dirname, "build-registry.ts");
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);

  try {
    const { stdout, stderr } = await execAsync(`npx tsx ${buildScript}`);
    console.log(stdout);
    if (stderr) console.error(stderr);
  } catch (error) {
    log(`Build failed: ${error}`, "error");
    throw error;
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

  // Write output files grouped by owner
  const communityResult = await writeRegistryFiles(validSkills, "community");
  const mcpResult = await writeRegistryFiles(validMcps, "mcp");

  // Update index
  const totalSkills = communityResult.totalCount + mcpResult.totalCount;
  await updateIndex(communityResult.files, mcpResult.files, totalSkills);

  // Run build
  if (!CONFIG.dryRun) {
    await runBuild();
  }

  log("=== Sync Complete ===");
  log(
    `Skills: ${communityResult.totalCount} (${communityResult.files.length} files) | MCPs: ${mcpResult.totalCount} (${mcpResult.files.length} files)`
  );
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
