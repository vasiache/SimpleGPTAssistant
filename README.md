**A lightweight VS Code extension for interacting with OpenAI models directly in the editor**

**📋 Overview**

SimpleGPT integrates OpenAI capabilities directly into VS Code, allowing you to:
- Chat with OpenAI models in the chat panel
- Create, save, and use your own prompts
- Process selected text using saved prompts
- Configure API parameters and select models

**✨ Key Features**

**🤖 SimpleGPT Chat Panel**  
Built-in chat panel for interacting with OpenAI models without leaving the editor.

**📝 Prompt Management**  
Create, edit, and delete your own prompts for reuse.

**📑 Context Menu**  
Select text, right-click, and use prompts directly from the context menu.

**⚙️ API Configuration**  
Easily configure your API key, URL, and select the model to use.

**🔧 Installation**
- Open VS Code
- Go to Extensions section
- Search for "SimpleGPT" and click Install
- Or install from a VSIX file:
- Download the latest version from releases
- In VS Code: Extensions → ⋮ → Install from VSIX...

**🚀 Getting Started**

**Setting up the API key**
- Open the SimpleGPT panel in the VS Code sidebar
- Click the "Set API URL" button to configure the API URL (the official OpenAI API is used by default)
- Click the "Set Model" button to select a model (gpt-3.5-turbo, gpt-4, etc.)

**Creating a prompt**
- Click the "Add Prompt" button in the chat panel
- Enter the prompt name
- Enter the prompt content in the editor that opens
- Click "Save"

**Using a prompt**

**In the chat panel:**
- Select a prompt from the dropdown list
- Enter a message and click "Send"

**With selected text:**
- Select text in the editor
- Right-click and select "SimpleGPT: Use with Prompt"
- Choose the desired prompt from the list
- The result will appear in the chat panel

**📚 Commands**

SimpleGPT adds the following commands to the VS Code command palette (Ctrl+Shift+P / Cmd+Shift+P):
- `SimpleGPT: Open Chat` - Opens the chat panel
- `SimpleGPT: Add Prompt` - Creates a new prompt
- `SimpleGPT: Show Prompts` - Shows the list of saved prompts
- `SimpleGPT: Delete Prompt` - Deletes the selected prompt
- `SimpleGPT: Set API Key` - Sets the API key
- `SimpleGPT: Set API URL` - Sets the API URL
- `SimpleGPT: Set Model` - Selects the model to use

**📋 Requirements**  
Visual Studio Code version 1.60.0 or higher  
Valid OpenAI API key or compatible service

**🤝 Contributing**  
Contributions to the project are welcome! If you have ideas for improving the extension:
- Fork the repository
- Create a branch for your changes (`git checkout -b feature/amazing-feature`)
- Make your changes and commit them (`git commit -m 'Add some amazing feature'`)
- Push the changes to your fork (`git push origin feature/amazing-feature`)
- Open a Pull Request

**📜 License**  
Distributed under the MIT License. See the LICENSE file for more information.

**⚙️ Settings**  
SimpleGPT can be configured through settings.json in VS Code:

```json
{
  "simplegpt.apiKey": "your-api-key",
  "simplegpt.apiUrl": "https://api.openai.com/v1/chat/completions",
  "simplegpt.model": "gpt-3.5-turbo"
}
```
**📞 Contact**
GitHub Issues: https://github.com/vasiache/simpleGPTextention/issues