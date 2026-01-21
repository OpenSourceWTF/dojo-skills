#!/usr/bin/env npx tsx
/**
 * Registry Build Script
 * 
 * Aggregates all separate registry JSON files into a single `all.json` file.
 * This file serves as a pre-computed search index for the CLI, enabling
 * "Instant Search" without thousands of HTTP requests.
 */

import * as fs from "fs/promises";
import * as path from "path";

const CONFIG = {
  registryDir: path.join(import.meta.dirname, "..", "registry"),
  outputFile: "all.json"
};

interface IndexJson {
  categories: Record<string, string[]>;
}

interface RegistryFile {
  skills: Record<string, any>;
}

async function main() {
  console.log("Building registry index...");

  const indexPath = path.join(CONFIG.registryDir, "index.json");
  const indexContent = await fs.readFile(indexPath, "utf-8");
  const index: IndexJson = JSON.parse(indexContent);

  const allSkills: Record<string, any> = {};
  let fileCount = 0;

  // Iterate all categories (official, community, mcp, cursor)
  for (const [category, files] of Object.entries(index.categories)) {
    console.log(`Processing category: ${category} (${files.length} files)`);

    for (const file of files) {
      const filePath = path.join(CONFIG.registryDir, category, file);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const registry: RegistryFile = JSON.parse(content);

        // Merge skills
        // Note: Using assign allows overrides if keys collide (later categories override earlier?)
        // The order in `index.json` iteration matters.
        Object.assign(allSkills, registry.skills);
        fileCount++;
      } catch (error) {
        console.warn(`Failed to read/parse ${filePath}:`, error);
      }
    }
  }

  const output: RegistryFile = { skills: allSkills };
  const outputPath = path.join(CONFIG.registryDir, CONFIG.outputFile);

  await fs.writeFile(outputPath, JSON.stringify(output, null, 2));

  const size = (await fs.stat(outputPath)).size / 1024;
  console.log(`\nSuccess! Wrote ${Object.keys(allSkills).length} skills to ${CONFIG.outputFile}`);
  console.log(`Processed ${fileCount} files.`);
  console.log(`Total index size: ${size.toFixed(2)} KB`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
