// Lightweight agent runner: plan -> step -> observe -> respond (loop, capped).

async function runAgent({ role, task, tools = {}, maxSteps = 4 }) {
  const transcript = [];
  const toolList = Object.keys(tools).map((n) => `- ${n}: ${tools[n].description}`).join('\n');
  const system = `You are an autonomous ${role}. Break the task into steps.
Available tools:
${toolList || '(none)'}

Respond ONLY with JSON of shape:
{"thought": "...", "action": "tool_name | FINAL", "input": "...", "answer": "final answer (only when action=FINAL)"}`;

  let observation = '';
  for (let step = 0; step < maxSteps; step++) {
    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: `Task: ${task}\nPrevious observation: ${observation || '(none)'}\nTranscript:\n${transcript.map((t) => JSON.stringify(t)).join('\n')}` },
    ];
    const raw = await chat(messages, { temperature: 0.3, maxTokens: 700 });
    let parsed;
    try {
      parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw);
    } catch {
      return { answer: raw, transcript };
    }
    transcript.push({ step, ...parsed });
    if (parsed.action === 'FINAL' || !parsed.action) {
      return { answer: parsed.answer || parsed.thought || raw, transcript };
    }
    const tool = tools[parsed.action];
    if (!tool) {
      observation = `Tool ${parsed.action} not found`;
      continue;
    }
    try {
      observation = String(await tool.run(parsed.input));
    } catch (e) {
      observation = `Tool error: ${e.message}`;
    }
  }
  return { answer: 'Step limit reached.', transcript };
}

module.exports = { runAgent };
