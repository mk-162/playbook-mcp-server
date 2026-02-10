#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import { execSync } from "child_process";
import YAML from "yaml";

// Configuration
const PLAYBOOK_PATH = process.env.PLAYBOOK_PATH || process.cwd();

// Five-Layer Model Paths
const PATHS = {
  // THE LIBRARY (Past/Present)
  context: "context",
  companyFacts: "context/company-facts",
  industryData: "context/industry-data",
  glossary: "context/glossary",
  
  // THE RULES (The Lens)
  directives: "directives",
  brandPositioning: "directives/brand-positioning",
  activeStrategy: "directives/active-strategy",
  constraints: "directives/constraints",
  
  // THE MAP (Future)
  plans: "plans",
  campaigns: "plans/campaigns",
  contentCalendar: "plans/content-calendar",
  roadmap: "plans/roadmap",
  
  // THE ENGINE (How)
  workflows: "workflows",
  procedures: "workflows/procedures",
  skills: "workflows/skills",
  
  // THE INGREDIENTS
  assets: "assets",
  templates: "assets/templates",
  visualKit: "assets/visual-kit",
  
  // THE WORKSPACE (Bot's area)
  workspace: "gbot",
  research: "gbot/01-research",
  drafts: "gbot/02-drafts",
  finals: "gbot/03-finals",
  
  // Legacy paths (for backward compatibility)
  legacyContext: "context",
  legacyWorkflows: "workflows",
  legacyTemplates: "templates",
};

// Helper: Sanitize path
function sanitizePath(inputPath: string): string {
  const normalized = path.normalize(inputPath).replace(/^(\.\.[\/\\])+/, "");
  return normalized;
}

// Helper: Read file safely
async function readPlaybookFile(relativePath: string): Promise<string> {
  const safePath = sanitizePath(relativePath);
  const fullPath = path.join(PLAYBOOK_PATH, safePath);
  if (!fullPath.startsWith(PLAYBOOK_PATH)) {
    throw new Error("Access denied: Path outside playbook");
  }
  return fs.readFile(fullPath, "utf-8");
}

// Helper: Write file safely
async function writePlaybookFile(relativePath: string, content: string): Promise<void> {
  const safePath = sanitizePath(relativePath);
  const fullPath = path.join(PLAYBOOK_PATH, safePath);
  if (!fullPath.startsWith(PLAYBOOK_PATH)) {
    throw new Error("Access denied: Path outside playbook");
  }
  // Ensure directory exists
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, "utf-8");
}

// Helper: Check if path exists
async function pathExists(relativePath: string): Promise<boolean> {
  const safePath = sanitizePath(relativePath);
  const fullPath = path.join(PLAYBOOK_PATH, safePath);
  try {
    await fs.access(fullPath);
    return true;
  } catch {
    return false;
  }
}

// Helper: List files in directory
async function listFiles(relativePath: string, extension?: string): Promise<string[]> {
  const safePath = sanitizePath(relativePath);
  const fullPath = path.join(PLAYBOOK_PATH, safePath);
  try {
    const entries = await fs.readdir(fullPath, { withFileTypes: true });
    let files = entries.filter((e) => e.isFile()).map((e) => e.name);
    if (extension) {
      files = files.filter((f) => f.endsWith(extension));
    }
    return files;
  } catch {
    return [];
  }
}

// Helper: List subdirectories
async function listDirs(relativePath: string): Promise<string[]> {
  const safePath = sanitizePath(relativePath);
  const fullPath = path.join(PLAYBOOK_PATH, safePath);
  try {
    const entries = await fs.readdir(fullPath, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

// Helper: Extract YAML frontmatter from markdown
function extractFrontmatter(content: string): { description?: string } {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
  const match = content.match(frontmatterRegex);
  
  if (!match) {
    return {};
  }
  
  try {
    const parsed = YAML.parse(match[1]);
    return {
      description: parsed?.description || undefined
    };
  } catch {
    return {};
  }
}

// Helper: Run gh command
function runGh(args: string): string {
  try {
    return execSync(`gh ${args}`, { 
      cwd: PLAYBOOK_PATH, 
      encoding: "utf-8",
      timeout: 30000 
    }).trim();
  } catch (error) {
    throw new Error(`GitHub CLI error: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

// Response prefix - makes it clear when data comes from The Librarian
const LIB_PREFIX = "📚 lib: ";

// Helper: Create response with lib prefix
function libResponse(text: string): { content: { type: string; text: string }[] } {
  return { content: [{ type: "text", text: LIB_PREFIX + text }] };
}

// Helper: Create JSON response with lib prefix
function libJsonResponse(data: object): { content: { type: string; text: string }[] } {
  return { content: [{ type: "text", text: LIB_PREFIX + JSON.stringify(data, null, 2) }] };
}

// Helper: Find file in multiple possible locations
async function findFile(name: string, locations: string[]): Promise<string | null> {
  for (const loc of locations) {
    const filePath = `${loc}/${name}.md`;
    if (await pathExists(filePath)) {
      return filePath;
    }
    // Also try subdirectories
    const dirs = await listDirs(loc);
    for (const dir of dirs) {
      const subPath = `${loc}/${dir}/${name}.md`;
      if (await pathExists(subPath)) {
        return subPath;
      }
    }
  }
  return null;
}

// Create server
const server = new Server(
  { name: "162-playbook", version: "3.0.0" },
  { capabilities: { tools: {} } }
);

// Define tools
const tools = [
  // === DIRECTIVES (The Rules) ===
  {
    name: "get_directives",
    description: "Retrieve directives (brand, strategy, constraints). Omit section to list available.",
    inputSchema: {
      type: "object" as const,
      properties: {
        section: { type: "string", description: 'Section: "brand", "strategy", "constraints", or subfolder name' },
      },
      required: [],
    },
  },
  
  // === CONTEXT (The Library) ===
  {
    name: "get_context",
    description: "Retrieve context files (company facts, industry data). Omit section to list available.",
    inputSchema: {
      type: "object" as const,
      properties: {
        section: { type: "string", description: 'Section: "company-facts", "industry-data", "glossary", "founder", etc.' },
      },
      required: [],
    },
  },
  
  // === WORKFLOWS (The Engine) ===
  {
    name: "list_sops",
    description: "List all SOPs (Standard Operating Procedures) in workflows.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_sop",
    description: "Retrieve a specific SOP/workflow.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: 'SOP name (e.g., "blog-post", "client-discovery")' },
      },
      required: ["name"],
    },
  },
  
  // === Legacy aliases ===
  {
    name: "list_workflows",
    description: "List all available workflows. Alias for list_sops.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_workflow",
    description: "Retrieve a specific workflow. Alias for get_sop.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: 'Workflow name (e.g., "blog-post")' },
      },
      required: ["name"],
    },
  },
  
  // === TEMPLATES ===
  {
    name: "get_template",
    description: "Fetch a template for consistent formatting.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: 'Template name (e.g., "workflow-template")' },
      },
      required: ["name"],
    },
  },
  
  // === SEARCH ===
  {
    name: "search_playbook",
    description: "Search across all playbook files.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search term" },
      },
      required: ["query"],
    },
  },
  
  // === TASKS (GitHub Issues) ===
  {
    name: "list_tasks",
    description: "List tasks from GitHub Issues. Filter by label (active, backlog, all).",
    inputSchema: {
      type: "object" as const,
      properties: {
        label: { type: "string", description: 'Filter by label: "active", "backlog", or omit for all' },
      },
      required: [],
    },
  },
  {
    name: "add_task",
    description: "Create a new task as a GitHub Issue.",
    inputSchema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Task title" },
        body: { type: "string", description: "Task description" },
        label: { type: "string", description: 'Label: "active" or "backlog"' },
      },
      required: ["title"],
    },
  },
  {
    name: "complete_task",
    description: "Close a GitHub Issue.",
    inputSchema: {
      type: "object" as const,
      properties: {
        issue: { type: "number", description: "Issue number to close" },
        comment: { type: "string", description: "Optional closing comment" },
      },
      required: ["issue"],
    },
  },
  
  // === LOGGING ===
  {
    name: "log",
    description: "Log research/notes to the workspace (gbot/01-research/).",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Log name (becomes filename)" },
        content: { type: "string", description: "Content to log" },
        stage: { type: "string", description: 'Stage: "research", "drafts", or "finals"' },
      },
      required: ["name", "content"],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // === GET DIRECTIVES ===
      case "get_directives": {
        const parsed = z.object({ section: z.string().optional() }).parse(args);
        
        // Check new structure first, then legacy
        const directivesPath = await pathExists(PATHS.directives) ? PATHS.directives : null;
        const legacyPath = await pathExists(PATHS.legacyContext) ? PATHS.legacyContext : null;
        
        if (!directivesPath && !legacyPath) {
          return libJsonResponse({ error: "No directives or context directory found" });
        }
        
        if (!parsed.section) {
          // List available directives
          const sections: string[] = [];
          if (directivesPath) {
            const dirs = await listDirs(directivesPath);
            sections.push(...dirs);
            const files = await listFiles(directivesPath, ".md");
            sections.push(...files.map(f => f.replace(".md", "")));
          }
          return libJsonResponse({ available: sections, path: directivesPath || legacyPath });
        }
        
        // Map common aliases
        const sectionMap: Record<string, string[]> = {
          "brand": ["brand-positioning/brand", "brand-positioning", "brand"],
          "strategy": ["active-strategy/strategy", "active-strategy", "strategy"],
          "constraints": ["constraints/rules", "constraints", "rules"],
        };
        
        const searchPaths = sectionMap[parsed.section] || [parsed.section];
        
        // Try to find the file
        for (const searchPath of searchPaths) {
          const locations = directivesPath ? [directivesPath] : [];
          if (legacyPath) locations.push(legacyPath);
          
          for (const loc of locations) {
            const filePath = `${loc}/${searchPath}.md`;
            if (await pathExists(filePath)) {
              const content = await readPlaybookFile(filePath);
              return libResponse(content);
            }
          }
        }
        
        return libJsonResponse({ error: `Directive "${parsed.section}" not found` });
      }

      // === GET CONTEXT ===
      case "get_context": {
        const parsed = z.object({ section: z.string().optional() }).parse(args);
        
        // Check new structure first
        const contextPath = await pathExists(PATHS.context) ? PATHS.context : null;
        
        if (!contextPath) {
          return libJsonResponse({ error: "No context directory found" });
        }
        
        if (!parsed.section) {
          // List available context
          const sections: string[] = [];
          const dirs = await listDirs(contextPath);
          sections.push(...dirs);
          const files = await listFiles(contextPath, ".md");
          sections.push(...files.map(f => f.replace(".md", "")));
          return libJsonResponse({ available: sections, path: contextPath });
        }
        
        // Map common aliases
        const sectionMap: Record<string, string[]> = {
          "founder": ["company-facts/founder", "founder"],
          "company-facts": ["company-facts"],
          "industry-data": ["industry-data"],
          "glossary": ["glossary"],
        };
        
        const searchPaths = sectionMap[parsed.section] || [parsed.section];
        
        for (const searchPath of searchPaths) {
          // Try direct path
          const filePath = `${contextPath}/${searchPath}.md`;
          if (await pathExists(filePath)) {
            const content = await readPlaybookFile(filePath);
            return libResponse(content);
          }
          // Try in subdirectory
          const subDirs = await listDirs(contextPath);
          for (const subDir of subDirs) {
            const subPath = `${contextPath}/${subDir}/${parsed.section}.md`;
            if (await pathExists(subPath)) {
              const content = await readPlaybookFile(subPath);
              return libResponse(content);
            }
          }
        }
        
        return libJsonResponse({ error: `Context "${parsed.section}" not found` });
      }

      // === LIST SOPS / WORKFLOWS ===
      case "list_sops":
      case "list_workflows": {
        const locations = [PATHS.procedures, PATHS.workflows, PATHS.legacyWorkflows];
        const allWorkflows: { name: string; path: string; description?: string }[] = [];
        
        for (const loc of locations) {
          if (!(await pathExists(loc))) continue;
          const files = await listFiles(loc, ".md");
          for (const f of files) {
            const content = await readPlaybookFile(`${loc}/${f}`);
            const { description } = extractFrontmatter(content);
            allWorkflows.push({
              name: f.replace(".md", ""),
              path: `${loc}/${f}`,
              ...(description && { description })
            });
          }
        }
        
        return libJsonResponse({ workflows: allWorkflows });
      }

      // === GET SOP / WORKFLOW ===
      case "get_sop":
      case "get_workflow": {
        const parsed = z.object({ name: z.string() }).parse(args);
        const locations = [PATHS.procedures, PATHS.workflows, PATHS.legacyWorkflows];
        
        const filePath = await findFile(parsed.name, locations);
        if (!filePath) {
          return libJsonResponse({ error: `Workflow "${parsed.name}" not found` });
        }
        
        const content = await readPlaybookFile(filePath);
        return libResponse(content);
      }

      // === GET TEMPLATE ===
      case "get_template": {
        const parsed = z.object({ name: z.string() }).parse(args);
        const locations = [PATHS.templates, PATHS.legacyTemplates];
        
        const filePath = await findFile(parsed.name, locations);
        if (!filePath) {
          return libJsonResponse({ error: `Template "${parsed.name}" not found` });
        }
        
        const content = await readPlaybookFile(filePath);
        return libResponse(content);
      }

      // === SEARCH ===
      case "search_playbook": {
        const parsed = z.object({ query: z.string() }).parse(args);
        const query = parsed.query.toLowerCase();
        const results: { path: string; snippet: string }[] = [];
        
        // Search all directories
        const searchDirs = [
          PATHS.context, PATHS.directives, PATHS.plans,
          PATHS.workflows, PATHS.assets, PATHS.workspace,
          // Legacy
          PATHS.legacyContext, PATHS.legacyWorkflows, PATHS.legacyTemplates
        ];
        
        for (const dir of searchDirs) {
          if (!(await pathExists(dir))) continue;
          
          // Search files in this directory
          const files = await listFiles(dir, ".md");
          for (const file of files) {
            const filePath = `${dir}/${file}`;
            const content = await readPlaybookFile(filePath);
            if (content.toLowerCase().includes(query)) {
              const lines = content.split("\n");
              const matchLine = lines.find((l) => l.toLowerCase().includes(query));
              results.push({ path: filePath, snippet: matchLine?.substring(0, 100) || "" });
            }
          }
          
          // Search subdirectories
          const subDirs = await listDirs(dir);
          for (const subDir of subDirs) {
            const subPath = `${dir}/${subDir}`;
            const subFiles = await listFiles(subPath, ".md");
            for (const file of subFiles) {
              const filePath = `${subPath}/${file}`;
              const content = await readPlaybookFile(filePath);
              if (content.toLowerCase().includes(query)) {
                const lines = content.split("\n");
                const matchLine = lines.find((l) => l.toLowerCase().includes(query));
                results.push({ path: filePath, snippet: matchLine?.substring(0, 100) || "" });
              }
            }
          }
        }
        
        return libJsonResponse({ results });
      }

      // === TASKS ===
      case "list_tasks": {
        const parsed = z.object({ label: z.string().optional() }).parse(args);
        const ghArgs = "issue list --json number,title,labels,state --limit 50";
        const result = runGh(ghArgs);
        let issues = JSON.parse(result || "[]");
        
        if (parsed.label) {
          issues = issues.filter((issue: any) => 
            issue.labels?.some((l: any) => l.name === parsed.label)
          );
        }
        
        const simplified = issues.map((issue: any) => ({
          number: issue.number,
          title: issue.title,
          labels: issue.labels?.map((l: any) => l.name) || [],
          state: issue.state,
        }));
        
        return libJsonResponse({ tasks: simplified });
      }

      case "add_task": {
        const parsed = z.object({
          title: z.string(),
          body: z.string().optional(),
          label: z.string().optional(),
        }).parse(args);
        const label = parsed.label || "active";
        let ghArgs = `issue create --title "${parsed.title.replace(/"/g, '\\"')}"`;
        if (parsed.body) {
          ghArgs += ` --body "${parsed.body.replace(/"/g, '\\"')}"`;
        }
        ghArgs += ` --label ${label}`;
        const result = runGh(ghArgs);
        return libJsonResponse({ success: true, url: result });
      }

      case "complete_task": {
        const parsed = z.object({
          issue: z.number(),
          comment: z.string().optional(),
        }).parse(args);
        if (parsed.comment) {
          runGh(`issue close ${parsed.issue} --comment "${parsed.comment.replace(/"/g, '\\"')}"`);
        } else {
          runGh(`issue close ${parsed.issue}`);
        }
        return libJsonResponse({ success: true, closed: parsed.issue });
      }

      // === LOGGING ===
      case "log": {
        const parsed = z.object({
          name: z.string(),
          content: z.string(),
          stage: z.string().optional(),
        }).parse(args);

        // Determine target directory based on stage
        const stageMap: Record<string, string> = {
          "research": PATHS.research,
          "drafts": PATHS.drafts,
          "finals": PATHS.finals,
        };
        const targetDir = stageMap[parsed.stage || "research"] || PATHS.research;
        
        // Fallback to legacy if new structure doesn't exist
        const finalDir = await pathExists(PATHS.workspace) ? targetDir : PATHS.legacyContext;

        const filename = parsed.name.toLowerCase().replace(/[^a-z0-9-]/g, "-") + ".md";
        const filePath = `${finalDir}/${filename}`;
        
        let existingContent = "";
        if (await pathExists(filePath)) {
          existingContent = await readPlaybookFile(filePath);
          existingContent += "\n\n---\n\n";
        }
        
        const timestamp = new Date().toISOString().split("T")[0];
        const newContent = existingContent + `*Logged: ${timestamp}*\n\n${parsed.content}`;
        
        await writePlaybookFile(filePath, newContent);
        return libJsonResponse({ success: true, path: filePath });
      }

      default:
        return libJsonResponse({ error: `Unknown tool: ${name}` });
    }
  } catch (error) {
    return libJsonResponse({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("162 Playbook MCP server v3.0.0 running (Five-Layer Model)");
}

main().catch(console.error);
