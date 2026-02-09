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
const PLAYBOOK_PATH = process.env.HANDBOOK_PATH || process.cwd();

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

// Helper: List files
async function listFiles(relativePath: string, extension?: string): Promise<string[]> {
  const safePath = sanitizePath(relativePath);
  const fullPath = path.join(PLAYBOOK_PATH, safePath);
  const entries = await fs.readdir(fullPath, { withFileTypes: true });
  let files = entries.filter((e) => e.isFile()).map((e) => e.name);
  if (extension) {
    files = files.filter((f) => f.endsWith(extension));
  }
  return files;
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

// Create server
const server = new Server(
  { name: "162-playbook", version: "2.1.0" },
  { capabilities: { tools: {} } }
);

// Define tools
const tools = [
  {
    name: "list_workflows",
    description: "List all available workflows (step-by-step procedures).",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_context",
    description: "Retrieve context files (brand, strategy, etc.). Omit section to list available.",
    inputSchema: {
      type: "object" as const,
      properties: {
        section: { type: "string", description: 'Context section (e.g., "brand", "strategy")' },
      },
      required: [],
    },
  },
  {
    name: "get_workflow",
    description: "Retrieve a specific workflow with full instructions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: 'Workflow name (e.g., "blog-post")' },
      },
      required: ["name"],
    },
  },
  {
    name: "get_template",
    description: "Fetch a template for consistent formatting.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: 'Template name (e.g., "sop-template")' },
      },
      required: ["name"],
    },
  },
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
  {
    name: "list_tasks",
    description: "List tasks from GitHub Issues. Filter by label (active, backlog, all).",
    inputSchema: {
      type: "object" as const,
      properties: {
        label: { type: "string", description: 'Filter by label: "active", "backlog", or omit for all open issues' },
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
        body: { type: "string", description: "Task description/objective" },
        label: { type: "string", description: 'Label: "active" or "backlog" (default: active)' },
      },
      required: ["title"],
    },
  },
  {
    name: "complete_task",
    description: "Close a GitHub Issue (mark task as complete).",
    inputSchema: {
      type: "object" as const,
      properties: {
        issue: { type: "number", description: "Issue number to close" },
        comment: { type: "string", description: "Optional closing comment" },
      },
      required: ["issue"],
    },
  },
  {
    name: "log",
    description: "Log anything to the playbook. Creates or appends to a file in context/.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Log name (becomes filename)" },
        content: { type: "string", description: "Content to log" },
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
      case "list_workflows": {
        if (!(await pathExists("workflows"))) {
          return libJsonResponse({ error: "No workflows directory" });
        }
        const files = await listFiles("workflows", ".md");
        const workflows = await Promise.all(
          files.map(async (f) => {
            const content = await readPlaybookFile(`workflows/${f}`);
            const { description } = extractFrontmatter(content);
            return {
              name: f.replace(".md", ""),
              path: `workflows/${f}`,
              ...(description && { description })
            };
          })
        );
        return libJsonResponse({ workflows });
      }

      case "get_context": {
        const parsed = z.object({ section: z.string().optional() }).parse(args);
        if (!(await pathExists("context"))) {
          return libJsonResponse({ error: "No context directory" });
        }
        if (!parsed.section) {
          const files = await listFiles("context", ".md");
          return libJsonResponse({ available: files.map((f) => f.replace(".md", "")) });
        }
        const filePath = `context/${parsed.section}.md`;
        if (!(await pathExists(filePath))) {
          return libJsonResponse({ error: `Section "${parsed.section}" not found` });
        }
        const content = await readPlaybookFile(filePath);
        return libResponse(content);
      }

      case "get_workflow": {
        const parsed = z.object({ name: z.string() }).parse(args);
        const filePath = `workflows/${parsed.name}.md`;
        if (!(await pathExists(filePath))) {
          return libJsonResponse({ error: `Workflow "${parsed.name}" not found` });
        }
        const content = await readPlaybookFile(filePath);
        return libResponse(content);
      }

      case "get_template": {
        const parsed = z.object({ name: z.string() }).parse(args);
        const filePath = `templates/${parsed.name}.md`;
        if (!(await pathExists(filePath))) {
          return libJsonResponse({ error: `Template "${parsed.name}" not found` });
        }
        const content = await readPlaybookFile(filePath);
        return libResponse(content);
      }

      case "search_playbook": {
        const parsed = z.object({ query: z.string() }).parse(args);
        const query = parsed.query.toLowerCase();
        const results: { path: string; snippet: string }[] = [];
        const dirs = ["context", "workflows", "templates"];
        for (const dir of dirs) {
          if (!(await pathExists(dir))) continue;
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
        }
        return libJsonResponse({ results });
      }

      case "list_tasks": {
        const parsed = z.object({ label: z.string().optional() }).parse(args);
        const ghArgs = "issue list --json number,title,labels,state --limit 50";
        const result = runGh(ghArgs);
        let issues = JSON.parse(result || "[]");
        
        // Filter by label if specified
        if (parsed.label) {
          issues = issues.filter((issue: any) => 
            issue.labels?.some((l: any) => l.name === parsed.label)
          );
        }
        
        // Simplify the output
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

      case "log": {
        const parsed = z.object({
          name: z.string(),
          content: z.string(),
        }).parse(args);

        const filename = parsed.name.toLowerCase().replace(/[^a-z0-9-]/g, "-") + ".md";
        const filePath = `context/${filename}`;
        
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
  console.error("162 Playbook MCP server v2.0.0 running (with GitHub Issues)");
}

main().catch(console.error);
