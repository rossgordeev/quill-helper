import ollama from 'ollama'; 

/**
 * Ask the local Ollama model for a response
 * @param prompt - User input text
 */
export async function OllamaChat(prompt: string): Promise<string> {
  try {
    const response = await ollama.chat({
      model: 'llama3',
      messages: [
        { role: 'user', content: prompt }
      ],
    });

    return response.message.content;
  } catch (err) {
    console.error('OllamaChat error:', err);
    return 'Error talking to LLM: ' + String(err);
  }
}
