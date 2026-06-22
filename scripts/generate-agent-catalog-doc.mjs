#!/usr/bin/env node
/**
 * Generate agent-catalog.md documentation from persona-catalog.ts
 * 
 * This script reads the PERSONA_CATEGORIES and PERSONAS from the source of truth
 * and generates a markdown documentation file.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

// Path to the persona catalog source
const personaCatalogPath = join(repoRoot, 'apps/openape-troop/shared/persona-catalog.ts');
const docsOutputPath = join(repoRoot, 'apps/docs/content/2.ecosystem/9.agent-catalog.md');

// Read the persona catalog
const catalogContent = readFileSync(personaCatalogPath, 'utf-8');

// Extract PERSONA_CATEGORIES
const categoriesMatch = catalogContent.match(/export const PERSONA_CATEGORIES[^=]*=\s*\[([\s\S]*?)\]/);
if (!categoriesMatch) {
  console.error('Could not parse PERSONA_CATEGORIES');
  process.exit(1);
}

const categoriesRaw = categoriesMatch[1];
const categories = [];
const categoryRegex = /\{\s*key:\s*'([^']+)'(?:\s*,\s*label:\s*'([^']+)')?\s*\}/g;
let match;
while ((match = categoryRegex.exec(categoriesRaw)) !== null) {
  categories.push({ key: match[1], label: match[2] || match[1] });
}

// Extract PERSONAS - parse line by line for robustness
const personas = [];
const lines = catalogContent.split('\n');
let inPersonas = false;
let currentPersona = {};

for (const line of lines) {
  if (line.includes('export const PERSONAS')) {
    inPersonas = true;
    continue;
  }
  
  if (inPersonas) {
    // Check for key
    const keyMatch = line.match(/key:\s*'([^']+)'/);
    if (keyMatch) {
      currentPersona.key = keyMatch[1];
    }
    
    const titleMatch = line.match(/title:\s*'([^']+)'/);
    if (titleMatch) {
      currentPersona.title = titleMatch[1];
    }
    
    const roleMatch = line.match(/role:\s*'([^']+)'/);
    if (roleMatch) {
      currentPersona.role = roleMatch[1];
    }
    
    const categoryMatch = line.match(/category:\s*'([^']+)'/);
    if (categoryMatch) {
      currentPersona.category = categoryMatch[1];
    }
    
    const iconMatch = line.match(/icon:\s*'([^']+)'/);
    if (iconMatch) {
      currentPersona.icon = iconMatch[1];
    }
    
    // Match summary with escaped quotes
    const summaryMatch = line.match(/summary:\s*'((?:[^'\\]|\\.)+)'/);
    if (summaryMatch) {
      currentPersona.summary = summaryMatch[1].replace(/\\'/g, "'");
    }
    
    const codingMatch = line.match(/coding:\s*(true|false)/);
    if (codingMatch) {
      currentPersona.coding = codingMatch[1] === 'true';
    }
    
    const recipeRefMatch = line.match(/recipeRef:\s*'([^']+)'/);
    if (recipeRefMatch) {
      currentPersona.recipeRef = recipeRefMatch[1];
    }
    
    // End of persona object
    if (line.trim() === '},' || line.trim() === '}]') {
      if (currentPersona.key && currentPersona.title) {
        personas.push({ ...currentPersona });
      }
      currentPersona = {};
    }
  }
}

console.log(`Parsed ${personas.length} personas and ${categories.length} categories`);

// Generate markdown
const generateMarkdown = () => {
  let md = `---
title: Agent Catalog
description: The catalog of ${personas.length} personas available to compose your OpenApe company.
---

# Agent Catalog

The **Agent Catalog** is the authoritative list of all personas you can spawn to compose your OpenApe company. Each persona is a pre-configured agent recipe pinned to a specific version in the [agent-catalog](https://github.com/openape-ai/agent-catalog) repository.

> **Source of Truth**: This documentation is auto-generated from \`apps/openape-troop/shared/persona-catalog.ts\`. Do not edit manually.

## Source of Truth

- **Persona definitions**: \`apps/openape-troop/shared/persona-catalog.ts\` (auto-generated from \`agent-catalog\`)
- **Recipe sources**: \`github.com/openape-ai/agent-catalog\` (pinned versions per persona)
- **Validation**: \`apps/openape-troop/scripts/validate-catalog.ts\`
- **Generator**: \`scripts/generate-agent-catalog-doc.mjs\`

## Categories

The catalog groups personas into ${categories.length} categories:

| Category | Key | Description |
|----------|-----|-------------|
`;

  for (const cat of categories) {
    md += `| ${cat.label} | \`${cat.key}\` | - |\n`;
  }

  md += '\n## Personas\n\n';

  // Group personas by category
  const personasByCategory = {};
  for (const cat of categories) {
    personasByCategory[cat.key] = personas.filter(p => p.category === cat.key);
  }

  for (const cat of categories) {
    const catPersonas = personasByCategory[cat.key];
    if (catPersonas.length === 0) continue;

    md += `### ${cat.label}\n\n`;
    md += '| Persona | Role | Coding | Summary |\n';
    md += '|---------|------|--------|---------|\n';

    for (const p of catPersonas) {
      const coding = p.coding ? 'Yes' : 'No';
      md += `| **${p.title}** | \`${p.role}\` | ${coding} | ${p.summary} |\n`;
    }

    md += '\n';
  }

  md += `## How to Compose a Company

The company view in [troop](https://troop.openape.ai/companies) lets you compose a company by spawning personas from this catalog:

1. **Identify capability gaps**: Review your current team and determine which personas are missing.
2. **Spawn personas**: Use the troop UI or CLI to spawn agents with specific personas.
3. **Assign roles**: Each persona comes with a structural org-chart role (\`ceo\`, \`teamlead\`, \`specialist\`, \`sanierer\`, \`other\`) that determines their position in the org chart.
4. **Enable collaboration**: Spawned agents can communicate, delegate tasks, and work together based on their roles and capabilities.

### Example: Building a Minimal Team

A minimal product team might include:
- **CEO** (leadership) - Sets direction and objectives
- **Product Manager** (leadership) - Maintains backlog and prioritizes
- **Full-Stack Engineer** (engineering) - Builds features end-to-end
- **QA / Test Engineer** (engineering) - Ensures quality
- **Technical Writer** (design-content) - Documents the work

### Recipe References

Each persona references a pinned recipe from \`github.com/openape-ai/agent-catalog\`. The recipe includes:
- System prompt (intent)
- Capabilities (tools the agent can use)
- Parameters (configurable at spawn time)
- Schedules (if the agent runs on a timer)

All recipes are versioned (e.g., \`@v0.2.0\`) to ensure reproducibility and safe upgrades.

## Generating This Documentation

To regenerate this documentation after changes to the persona catalog:

\`\`\`bash
node scripts/generate-agent-catalog-doc.mjs
\`\`\`

## Related Documentation

- [Agent Recipe](/ecosystem/agent-recipe) - How recipes work
- [Quick Start: Agent](/getting-started/quickstart-agent) - Deploy your first agent
- [Capabilities & Grants](/guides/capabilities) - The consent model
`;

  return md;
};

const markdown = generateMarkdown();
writeFileSync(docsOutputPath, markdown, 'utf-8');

console.log(`Generated ${docsOutputPath}`);
console.log(`- Categories: ${categories.length}`);
console.log(`- Personas: ${personas.length}`);
