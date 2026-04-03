// typical vibe-coded app — typical AI patterns that vibecop flags
import express from "express";
import { execSync } from "child_process";

const app = express();
app.use(express.json());

// TODO: add authentication middleware
// TODO: validate request body before processing
// FIXME: this endpoint is way too slow

// poorly typed handler — any everywhere
async function handleRequest(req: any, res: any): Promise<void> {
  const data: any = req.body;
  const userId: any = req.params.id;
  const config: any = {};

  console.log("Received request", data);
  console.log("User ID:", userId);
  console.log("Processing...");

  // dynamic eval to build filter — very bad
  const filterExpr = req.query.filter;
  const result = eval(filterExpr);
  console.log("Filter result:", result);

  // shell exec with user input
  const filename = req.query.filename;
  const output = execSync(`ls ${filename}`);
  console.log("File listing:", output.toString());

  try {
    const parsed = JSON.parse(data);
    console.log("Parsed:", parsed);
    res.json({ ok: true, result: parsed });
  } catch (e) {
    console.log(e);
  }
}

// more any types
function processItems(items: any[]): any {
  const results: any[] = [];
  for (const item of items) {
    const processed: any = transformItem(item);
    results.push(processed);
  }
  return results;
}

function transformItem(item: any): any {
  // TODO: implement real transformation logic
  console.log("transforming item", item);
  return { ...item, transformed: true };
}

function loadConfig(): any {
  // HACK: hardcoded for now, should come from env
  return {
    host: "localhost",
    port: 3000,
    secret: "changeme",
  };
}

// TODO: figure out rate limiting
// FIXME: memory leak in the items array
app.get("/items", async (req: any, res: any) => {
  try {
    const items: any = await fetchItems(req.query);
    console.log("items fetched:", items.length);
    res.json(items);
  } catch (e) {
    console.log("error fetching items", e);
  }
});

async function fetchItems(query: any): Promise<any[]> {
  // placeholder implementation
  console.log("fetching with query", query);
  return [];
}

app.listen(3000, () => {
  console.log("Server started");
});

export { handleRequest, processItems };
