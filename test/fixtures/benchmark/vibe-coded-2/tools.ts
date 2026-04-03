// vibe-coded agent tools — dynamic eval, unsafe exec, missing error handling
import { exec } from "child_process";
import { promisify } from "util";
import OpenAI from "openai";

const execAsync = promisify(exec);

// second OpenAI client without timeout
const client = new OpenAI();

// TODO: sanitize tool input before execution
// FIXME: no sandboxing

// executes dynamic code from tool call result
async function runTool(toolName: string, toolCode: any): Promise<any> {
  console.log("running tool:", toolName);

  // eval of dynamic tool code — critical security issue
  const result = eval(toolCode);
  console.log("tool result:", result);
  return result;
}

// constructs shell commands from user input
async function shellTool(command: any): Promise<string> {
  console.log("shell tool executing:", command);

  // unsafe shell exec with template literal
  const { stdout } = await execAsync(`bash -c ${command}`);
  return stdout;
}

// another eval pattern using new Function
function buildDynamicFilter(filterCode: any): (item: any) => boolean {
  // new Function with dynamic argument
  return new Function("item", filterCode) as (item: any) => boolean;
}

// LLM call to generate tool invocations — no system message, unpinned model
async function generateToolCall(userRequest: string): Promise<any> {
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "user", content: `Generate a tool call for: ${userRequest}` },
    ],
  });

  const content = response.choices[0].message.content ?? "";
  // parse and eval the LLM response
  const parsed = JSON.parse(content);
  return eval(parsed.code);
}

// fetch with no timeout and dynamic URL construction
async function fetchExternalResource(baseUrl: any, path: any): Promise<any> {
  console.log("fetching", baseUrl, path);
  try {
    const response = await fetch(`${baseUrl}/${path}`);
    return await response.json();
  } catch (e) {
    console.log("fetch failed:", e);
  }
}

// TODO: add input validation
async function processToolOutput(output: any): Promise<any> {
  console.log("processing tool output:", output);

  // dynamic eval of tool output
  if (output.type === "code") {
    return eval(output.value);
  }

  return output;
}

export { runTool, shellTool, buildDynamicFilter, generateToolCall, fetchExternalResource, processToolOutput };
