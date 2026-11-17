
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
// Root folder that the MCP is allowed to inspect

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);


// Folders we don't want to scan
const IGNORED_FOLDERS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
]);

const MAX_DEPTH = Number(
  process.env.FOLDER_STATS_MAX_DEPTH ?? "5"
);
const MAX_ENTRIES = 5000;

// Create MCP server
const server = new McpServer({
  name: "folder-stats-mcp",
  version: "1.0.0",
});

// Check that the requested path stays inside the project
async function getSafeDirectory(relativePath: string) {
  const root = await fs.realpath(PROJECT_ROOT);
  const requested = path.resolve(root, relativePath);
  const realPath = await fs.realpath(requested);

  const relative = path.relative(root, realPath);

  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Access outside project root is not allowed");
  }

  const stats = await fs.stat(realPath);

  if (!stats.isDirectory()) {
    throw new Error("The requested path is not a directory");
  }

  return realPath;
}

// Calculate folder statistics
async function calculateFolderStats(folderPath: string) {
  let fileCount = 0;
  let folderCount = 0;
  let totalSizeBytes = 0;
  let scannedEntries = 0;

  const fileTypes: Record<string, number> = {};

  async function scan(currentPath: string, depth: number) {
    if (depth > MAX_DEPTH) return;

    const entries = await fs.readdir(currentPath, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      scannedEntries++;

      if (scannedEntries > MAX_ENTRIES) {
        throw new Error("Scan limit exceeded");
      }

      const fullPath = path.join(currentPath, entry.name);

      // Skip symbolic links
      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        if (IGNORED_FOLDERS.has(entry.name)) continue;

        folderCount++;
        await scan(fullPath, depth + 1);
      } else if (entry.isFile()) {
        fileCount++;

        const stats = await fs.stat(fullPath);
        totalSizeBytes += stats.size;

        const extension = path.extname(entry.name) || "[no extension]";
        fileTypes[extension] = (fileTypes[extension] ?? 0) + 1;
      }
    }
  }

  await scan(folderPath, 0);

  return {
    files: fileCount,
    folders: folderCount,
    totalSizeBytes,
    totalSizeMB: Number(
      (totalSizeBytes / (1024 * 1024)).toFixed(2)
    ),
    fileTypes,
    maxDepth: MAX_DEPTH,
  };
}

// TOOL 1: Get folder statistics
server.registerTool(
  "get_folder_stats",
  {
    title: "Get Folder Statistics",
    description:
      "Count files, subfolders, total size and file types inside a project folder.",
    inputSchema: {
      folder_path: z
  .string()
  .min(1, "Folder path cannot be empty")
  .refine(
    (value) =>
      !path.isAbsolute(value) &&
      !path.win32.isAbsolute(value),
    "Folder path must be relative"
  )
  .default("."),
    },
  },
  async ({ folder_path }) => {
    try {
      const safePath = await getSafeDirectory(folder_path);
      const stats = await calculateFolderStats(safePath);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { folder: folder_path, ...stats },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              error instanceof Error
                ? error.message
                : "Unknown error",
          },
        ],
      };
    }
  }
);


 // TOOL 2: List files and folders
server.registerTool(
  "list_folder_contents",
  {
    title: "List Folder Contents",
    description:
      "List files and subfolders directly inside a project folder.",
    inputSchema: {
      folder_path: z
        .string()
        .default(".")
        .describe("Folder path relative to the project root"),
    },
  },
  async ({ folder_path }) => {
    try {
      // Validate the requested folder
      const safePath = await getSafeDirectory(folder_path);

      // Read the direct contents of the folder
      const entries = await fs.readdir(safePath, {
        withFileTypes: true,
      });

      const items = [];

      for (const entry of entries) {
        // Skip symbolic links and ignored folders
        if (entry.isSymbolicLink()) continue;

        if (
          entry.isDirectory() &&
          IGNORED_FOLDERS.has(entry.name)
        ) {
          continue;
        }

        const fullPath = path.join(safePath, entry.name);

        if (entry.isDirectory()) {
          items.push({
            name: entry.name,
            type: "directory",
            sizeBytes: null,
          });
        } else if (entry.isFile()) {
          const stats = await fs.stat(fullPath);

          items.push({
            name: entry.name,
            type: "file",
            sizeBytes: stats.size,
          });
        }

        if (items.length >= 200) break;
      }

      // Return the result to the MCP client
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                folder: folder_path,
                items,
                returnedItems: items.length,
                truncated: entries.length > 200,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              error instanceof Error
                ? error.message
                : "Unknown error",
          },
        ],
      };
    }
  }
);


 // RESOURCE: Project root folder statistics
server.registerResource(
  "root-folder-stats",
  "folder://root/stats",
  {
    title: "Root Folder Statistics",
    description:
      "Current statistics for the File Browser project root folder.",
    mimeType: "application/json",
  },
  async (uri) => {
    const rootPath = await getSafeDirectory(".");
    const stats = await calculateFolderStats(rootPath);

    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              folder: ".",
              ...stats,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

 // PROMPT: Analyze a project folder
server.registerPrompt(
  "analyze_folder",
  {
    title: "Analyze Folder",
    description:
      "Analyze a project folder using Folder Stats MCP tools.",
    argsSchema: {
      folder_path: z
        .string()
        .describe("Folder path relative to the project root"),
    },
  },
  ({ folder_path }) => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `
Analyze the project folder: "${folder_path}"

Use the Folder Stats MCP tools:

1. Call get_folder_stats with folder_path="${folder_path}"
   to get file counts, folder counts, sizes and file types.

2. Call list_folder_contents with folder_path="${folder_path}"
   to get the names of files and subfolders.

3. Present the results in Hebrew:
   - Folder path
   - Total number of files
   - Total number of subfolders
   - Total size
   - File types breakdown
   - List of direct files and subfolders

4. Finish with a short summary of the folder.

Do not modify, create or delete any files.
If a tool fails, report the error instead of guessing.
`,
          },
        },
      ],
    };
  }
);

// Connect to Claude Code

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("Folder Stats MCP server is running");
}

main().catch((error) => {
  console.error("MCP server error:", error);
  process.exit(1);
});
