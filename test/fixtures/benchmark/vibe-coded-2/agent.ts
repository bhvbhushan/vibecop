// vibe-coded LLM agent — all the common AI integration mistakes
import OpenAI from "openai";
import { execSync } from "child_process";

// no timeout on OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// unpinned model, no temperature, no max_tokens, no system message
async function askQuestion(question: string): Promise<string> {
  console.log("asking question:", question);
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "user", content: question },
    ],
  });
  return response.choices[0].message.content ?? "";
}

// unpinned model "gpt-4", no temperature, no system message
async function summarize(text: string): Promise<string> {
  console.log("summarizing text, length:", text.length);
  const response = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      { role: "user", content: `Summarize this: ${text}` },
    ],
  });
  return response.choices[0].message.content ?? "";
}

// execute arbitrary LLM-suggested code — extremely dangerous
async function runAgentSuggestion(userInput: string): Promise<string> {
  console.log("running agent suggestion for:", userInput);

  const codeResponse = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "user", content: `Write code to: ${userInput}` },
    ],
  });

  const code = codeResponse.choices[0].message.content ?? "";

  // dynamic eval of LLM output
  const result = eval(code);
  console.log("eval result:", result);
  return String(result);
}

// shell exec with dynamic LLM-generated command
async function executeAgentCommand(task: string): Promise<string> {
  const cmdResponse = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      { role: "user", content: `Give me a shell command to: ${task}` },
    ],
  });

  const command = cmdResponse.choices[0].message.content ?? "";
  console.log("executing command:", command);

  // executing LLM-generated shell command
  const output = execSync(`${command}`);
  return output.toString();
}

// TODO: add retry logic
// TODO: add rate limiting
// FIXME: this will break on long contexts
async function chainPrompts(prompts: string[]): Promise<string[]> {
  const results: string[] = [];
  for (const prompt of prompts) {
    try {
      const r = await askQuestion(prompt);
      results.push(r);
    } catch (e) {
      console.log("prompt failed:", e);
    }
  }
  return results;
}

export { askQuestion, summarize, runAgentSuggestion, executeAgentCommand, chainPrompts };
