import * as vscode from 'vscode';
import { ChatViewProvider } from './ChatViewProvider';
import { PromptManager } from './PromptManager';
import { OpenAIService } from './OpenAIService';

export function activate(context: vscode.ExtensionContext) {
  console.log('Активация расширения "simplegpt"');

  // Инициализация сервисов
  const promptManager = new PromptManager(context.globalState);
  const openAIService = new OpenAIService();
  const chatViewProvider = new ChatViewProvider(context.extensionUri, promptManager, openAIService);
  
  // Регистрация провайдера WebView
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'simplegpt.chatView',
      chatViewProvider
    )
  );

  // Регистрация всех команд
  registerCommands(context, promptManager, openAIService, chatViewProvider);
  
  // Регистрация контекстного меню
  context.subscriptions.push(
    vscode.commands.registerCommand('_simplegpt.contextMenu', () => {
      showPromptQuickPick(context, promptManager, openAIService, chatViewProvider);
    })
  );
}

// Функция для показа быстрого выбора промптов
async function showPromptQuickPick(
  context: vscode.ExtensionContext,
  promptManager: PromptManager,
  openAIService: OpenAIService,
  chatViewProvider: ChatViewProvider
) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    vscode.window.showInformationMessage('Выделите текст для использования SimpleGPT');
    return;
  }
  
  const prompts = promptManager.getPrompts();
  const promptNames = Object.keys(prompts);
  
  if (promptNames.length === 0) {
    vscode.window.showInformationMessage('Нет сохраненных промптов. Добавьте промпт через команду "simplegpt: Add Prompt"');
    return;
  }
  
  const selectedPrompt = await vscode.window.showQuickPick(
    promptNames,
    { placeHolder: 'Выберите промпт для использования' }
  );
  
  if (selectedPrompt) {
    try {
      // Сначала открываем панель чата
      await vscode.commands.executeCommand('simplegpt.chatView.focus');
      await new Promise(resolve => setTimeout(resolve, 500)); // Увеличиваем задержку для надежности
      
      // Затем обрабатываем запрос
      await processTextWithPrompt(editor, selectedPrompt, prompts[selectedPrompt], openAIService, chatViewProvider);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Ошибка при обработке запроса: ${error.message}`);
    }
  }
}

// Функция для обработки текста с промптом
async function processTextWithPrompt(
  editor: vscode.TextEditor,
  promptName: string,
  promptContent: string,
  openAIService: OpenAIService,
  chatViewProvider: ChatViewProvider
) {
  const selection = editor.selection;
  if (selection.isEmpty) {
    vscode.window.showWarningMessage('Нет выделенного текста');
    return;
  }
  
  const textToProcess = editor.document.getText(selection);
  
  try {
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Отправка запроса в OpenAI...',
      cancellable: false
    }, async () => {
      // Создаем элемент для ответа
      const responseId = `response-${Date.now()}`;
      
      // Проверяем, что view существует и доступен
      if (!chatViewProvider._view) {
        throw new Error('Окно чата не инициализировано');
      }
      
      chatViewProvider.addMessageToChat(`Промпт: ${promptName}\nЗапрос: ${textToProcess.length > 100 ? textToProcess.substring(0, 100) + '...' : textToProcess}`);
      
      chatViewProvider._view.webview.postMessage({ 
        command: 'createResponseElement', 
        id: responseId,
        prefix: 'SimpleGPT: '
      });
      
      // Переменная для сбора полного ответа
      let fullResponse = '';
      
      // Отправляем запрос с колбэком для стриминга
      await openAIService.sendRequest(
        promptContent, 
        textToProcess,
        (partialResponse) => {
          // Добавляем к полному ответу
          fullResponse += partialResponse;
          
          // Отправляем частичный ответ только если view все еще существует
          if (chatViewProvider._view) {
            chatViewProvider._view.webview.postMessage({ 
              command: 'appendToElement', 
              id: responseId,
              text: partialResponse
            });
          }
        }
      );
      
      // Завершаем ответ и сохраняем в историю, только если view все еще существует
      if (chatViewProvider._view) {
        chatViewProvider._view.webview.postMessage({ 
          command: 'finalizeResponse', 
          id: responseId
        });
      }
      
      // Сохраняем полный ответ в историю чата
      chatViewProvider.addApiResponseToChat('SimpleGPT: ', fullResponse);
    });
  } catch (error: any) {
    vscode.window.showErrorMessage(`Ошибка при отправке запроса: ${error.message}`);
    throw error; // Пробрасываем ошибку дальше для обработки
  }
}

// Функция для создания WebView с редактором промпта
function createPromptEditorWebview(
  context: vscode.ExtensionContext,
  promptName: string,
  existingContent: string = '',
  onSave: (content: string) => void
): vscode.WebviewPanel {
  // Создаем WebView панель
  const panel = vscode.window.createWebviewPanel(
    'promptEditor',
    `Редактор промпта: ${promptName}`,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true
    }
  );

  // Устанавливаем HTML содержимое
  panel.webview.html = getPromptEditorHtml(panel.webview, promptName, existingContent);

  // Обрабатываем сообщения от WebView
  panel.webview.onDidReceiveMessage(
    message => {
      switch (message.command) {
        case 'savePrompt':
          onSave(message.content);
          panel.dispose();
          return;
        case 'cancelPrompt':
          panel.dispose();
          return;
      }
    },
    undefined
  );

  return panel;
}

// Функция для получения HTML для редактора промптов
function getPromptEditorHtml(webview: vscode.Webview, promptName: string, content: string): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Редактор промпта: ${promptName}</title>
      <style>
        body {
          padding: 20px;
          color: var(--vscode-foreground);
          font-family: var(--vscode-font-family);
          background-color: var(--vscode-editor-background);
          display: flex;
          flex-direction: column;
          height: 100vh;
          margin: 0;
        }
        
        h2 {
          margin-top: 0;
          margin-bottom: 16px;
        }
        
        .container {
          display: flex;
          flex-direction: column;
          flex-grow: 1;
        }
        
        #prompt-content {
          flex-grow: 1;
          padding: 10px;
          margin-bottom: 16px;
          font-family: var(--vscode-editor-font-family);
          font-size: var(--vscode-editor-font-size);
          background-color: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
          border-radius: 4px;
          resize: none;
          min-height: 200px;
        }
        
        .button-container {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }
        
        button {
          padding: 8px 16px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }
        
        #save-button {
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
        }
        
        #save-button:hover {
          background-color: var(--vscode-button-hoverBackground);
        }
        
        #cancel-button {
          background-color: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
        }
        
        #cancel-button:hover {
          background-color: var(--vscode-button-secondaryHoverBackground);
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>Редактор промпта: ${promptName}</h2>
        <textarea id="prompt-content" placeholder="Введите содержимое промпта здесь">${content}</textarea>
        <div class="button-container">
          <button id="cancel-button">Отмена</button>
          <button id="save-button">Сохранить</button>
        </div>
      </div>
      
      <script>
        const vscode = acquireVsCodeApi();
        const promptContent = document.getElementById('prompt-content');
        const saveButton = document.getElementById('save-button');
        const cancelButton = document.getElementById('cancel-button');
        
        // Устанавливаем фокус на textarea
        promptContent.focus();
        
        // Обработчики кнопок
        saveButton.addEventListener('click', () => {
          const content = promptContent.value;
          vscode.postMessage({
            command: 'savePrompt',
            content: content
          });
        });
        
        cancelButton.addEventListener('click', () => {
          vscode.postMessage({
            command: 'cancelPrompt'
          });
        });
        
        // Обработка Ctrl+S
        document.addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            const content = promptContent.value;
            vscode.postMessage({
              command: 'savePrompt',
              content: content
            });
          }
        });
      </script>
    </body>
    </html>
  `;
}

function registerCommands(
  context: vscode.ExtensionContext, 
  promptManager: PromptManager, 
  openAIService: OpenAIService, 
  chatViewProvider: ChatViewProvider
) {
  // 1. Команда открытия чата
  const openChatDisposable = vscode.commands.registerCommand('simplegpt.openChat', () => {
    vscode.commands.executeCommand('simplegpt.chatView.focus');
  });
  context.subscriptions.push(openChatDisposable);

  // 2. Команда добавления промпта с использованием WebView
  const addPromptDisposable = vscode.commands.registerCommand('simplegpt.addPrompt', async () => {
    const promptName = await vscode.window.showInputBox({
      placeHolder: 'Введите название промпта',
      prompt: 'Название для нового промпта'
    });

    if (!promptName) {
      return;
    }

    // Проверяем, нет ли уже такого промпта
    const prompts = promptManager.getPrompts();
    let existingContent = '';
    
    if (prompts[promptName]) {
      const overwrite = await vscode.window.showWarningMessage(
        `Промпт с названием "${promptName}" уже существует. Перезаписать?`,
        'Да', 'Нет'
      );
      if (overwrite !== 'Да') {
        return;
      }
      existingContent = prompts[promptName];
    }

    // Создаем WebView для редактирования промпта
    createPromptEditorWebview(
      context,
      promptName,
      existingContent,
      (content) => {
        // Сохраняем промпт
        promptManager.addPrompt(promptName, content);
        vscode.window.showInformationMessage(`Промпт "${promptName}" сохранен.`);
        
        // Обновляем меню и список промптов
        refreshPromptCommands(context, promptManager, openAIService, chatViewProvider);
      }
    );
  });
  context.subscriptions.push(addPromptDisposable);

  // 3. Команда показа промптов
  const showPromptsDisposable = vscode.commands.registerCommand('simplegpt.showPrompts', async () => {
    const prompts = promptManager.getPrompts();
    
    if (Object.keys(prompts).length === 0) {
      vscode.window.showInformationMessage('Нет сохраненных промптов');
      return;
    }

    const promptsList = Object.entries(prompts).map(([name, content]) => {
      return `${name}: ${content}`;
    }).join('\n\n');

    const doc = await vscode.workspace.openTextDocument({
      content: promptsList,
      language: 'markdown'
    });
    
    await vscode.window.showTextDocument(doc);
  });
  context.subscriptions.push(showPromptsDisposable);

  // 4. Команда удаления промпта
  const deletePromptDisposable = vscode.commands.registerCommand('simplegpt.deletePrompt', async () => {
    const prompts = promptManager.getPrompts();
    
    if (Object.keys(prompts).length === 0) {
      vscode.window.showInformationMessage('Нет сохраненных промптов');
      return;
    }

    const promptName = await vscode.window.showQuickPick(
      Object.keys(prompts),
      { placeHolder: 'Выберите промпт для удаления' }
    );

    if (!promptName) {
      return;
    }

    promptManager.deletePrompt(promptName);
    vscode.window.showInformationMessage(`Промпт "${promptName}" удален`);
    
    // Обновляем меню и список промптов
    refreshPromptCommands(context, promptManager, openAIService, chatViewProvider);
  });
  context.subscriptions.push(deletePromptDisposable);

  // 5. Команда редактирования промпта
  const editPromptDisposable = vscode.commands.registerCommand('simplegpt.editPrompt', async () => {
    const prompts = promptManager.getPrompts();
    
    if (Object.keys(prompts).length === 0) {
      vscode.window.showInformationMessage('Нет сохраненных промптов для редактирования');
      return;
    }

    const promptName = await vscode.window.showQuickPick(
      Object.keys(prompts),
      { placeHolder: 'Выберите промпт для редактирования' }
    );

    if (!promptName) {
      return;
    }

    // Создаем WebView для редактирования промпта
    createPromptEditorWebview(
      context,
      promptName,
      prompts[promptName],
      (content) => {
        // Сохраняем промпт
        promptManager.addPrompt(promptName, content);
        vscode.window.showInformationMessage(`Промпт "${promptName}" обновлен.`);
        
        // Обновляем меню и список промптов
        refreshPromptCommands(context, promptManager, openAIService, chatViewProvider);
      }
    );
  });
  context.subscriptions.push(editPromptDisposable);

  // 6. Команда установки API ключа
  const setApiKeyDisposable = vscode.commands.registerCommand('simplegpt.setApiKey', async () => {
    const apiKey = await vscode.window.showInputBox({
      prompt: 'Введите ваш OpenAI API ключ',
      password: true,
      placeHolder: 'sk-...'
    });
    
    if (apiKey) {
      await vscode.workspace.getConfiguration('simplegpt').update('apiKey', apiKey, true);
      vscode.window.showInformationMessage('API ключ сохранен');
    }
  });
  context.subscriptions.push(setApiKeyDisposable);

  // 7. Команда сброса API ключа
  const resetApiKeyDisposable = vscode.commands.registerCommand('simplegpt.resetApiKey', async () => {
    await openAIService.resetApiKey();
  });
  context.subscriptions.push(resetApiKeyDisposable);

  // 8. Команда установки API URL
  const setApiUrlDisposable = vscode.commands.registerCommand('simplegpt.setApiUrl', async () => {
    const config = vscode.workspace.getConfiguration('simplegpt');
    const currentUrl = config.get<string>('apiUrl') || 'https://api.openai.com/v1/chat/completions';
    
    const apiUrl = await vscode.window.showInputBox({
      prompt: 'Введите URL OpenAI API',
      value: currentUrl,
      placeHolder: 'https://api.openai.com/v1/chat/completions'
    });
    
    if (apiUrl) {
      await config.update('apiUrl', apiUrl, true);
      vscode.window.showInformationMessage('API URL сохранен');
    }
  });
  context.subscriptions.push(setApiUrlDisposable);

  // 9. Команда установки модели
  const setModelDisposable = vscode.commands.registerCommand('simplegpt.setModel', async () => {
    const config = vscode.workspace.getConfiguration('simplegpt');
    const currentModel = config.get<string>('model') || 'gpt-3.5-turbo';
    
    const models = [
      'gpt-3.5-turbo',
      'gpt-4',
      'gpt-4-turbo',
      'gpt-4o',
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307'
    ];
    
    const model = await vscode.window.showQuickPick(models, {
      placeHolder: 'Выберите модель',
      canPickMany: false
    });
    
    if (model) {
      await config.update('model', model, true);
      vscode.window.showInformationMessage(`Модель ${model} сохранена`);
    }
  });
  context.subscriptions.push(setModelDisposable);

  // 10. Команда очистки истории чата
  const clearChatHistoryDisposable = vscode.commands.registerCommand('simplegpt.clearChatHistory', () => {
    chatViewProvider.clearChatHistory();
    vscode.window.showInformationMessage('История чата очищена');
  });
  context.subscriptions.push(clearChatHistoryDisposable);

  // Первоначальное создание команд для промптов
  refreshPromptCommands(context, promptManager, openAIService, chatViewProvider);
}

// Очистка и обновление команд промптов
function refreshPromptCommands(
  context: vscode.ExtensionContext,
  promptManager: PromptManager,
  openAIService: OpenAIService,
  chatViewProvider: ChatViewProvider
) {
  // 1. Удаляем все существующие команды промптов
  const commandsToRemove: vscode.Disposable[] = [];
  for (let i = 0; i < context.subscriptions.length; i++) {
    const subscription = context.subscriptions[i] as any;
    if (subscription && subscription._command && 
        typeof subscription._command === 'string' && 
        subscription._command.startsWith('simplegpt.prompt.')) {
      commandsToRemove.push(subscription);
    }
  }
  
  // Удаляем команды из списка подписок
  for (const cmd of commandsToRemove) {
    const index = context.subscriptions.indexOf(cmd);
    if (index !== -1) {
      context.subscriptions.splice(index, 1);
    }
    cmd.dispose();
  }
  
  // 2. Регистрируем команды для текущих промптов
  const prompts = promptManager.getPrompts();
  
  // Создаем команды для каждого промпта
  Object.keys(prompts).forEach(promptName => {
    const sanitizedName = sanitizeCommandName(promptName);
    const commandId = `simplegpt.prompt.${sanitizedName}`;
    
    // Регистрация команды
    const disposable = vscode.commands.registerCommand(commandId, async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('Нет активного редактора');
        return;
      }

      const selection = editor.selection;
      if (selection.isEmpty) {
        vscode.window.showWarningMessage('Нет выделенного текста');
        return;
      }
      
      const textToProcess = editor.document.getText(selection);
      
      try {
        // Сначала открываем панель чата и ждем ее инициализации
        await vscode.commands.executeCommand('simplegpt.chatView.focus');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: 'Отправка запроса в OpenAI...',
          cancellable: false
        }, async () => {
          const promptContent = prompts[promptName];
          
          // Проверяем, что view существует и доступен
          if (!chatViewProvider._view) {
            throw new Error('Окно чата не инициализировано');
          }
          
          // Создаем элемент для ответа
          const responseId = `response-${Date.now()}`;
          chatViewProvider.addMessageToChat(`Промпт: ${promptName}\nЗапрос: ${textToProcess.length > 100 ? textToProcess.substring(0, 100) + '...' : textToProcess}`);
          
          chatViewProvider._view.webview.postMessage({ 
            command: 'createResponseElement', 
            id: responseId,
            prefix: 'SimpleGPT: '
          });
          
          // Переменная для сбора полного ответа
          let fullResponse = '';
          
          // Отправляем запрос с колбэком для стриминга
          await openAIService.sendRequest(
            promptContent, 
            textToProcess,
            (partialResponse) => {
              // Добавляем к полному ответу
              fullResponse += partialResponse;
              
              // Отправляем частичный ответ только если view все еще существует
              if (chatViewProvider._view) {
                chatViewProvider._view.webview.postMessage({ 
                  command: 'appendToElement', 
                  id: responseId,
                  text: partialResponse
                });
              }
            }
          );
          
          // Завершаем ответ и сохраняем в историю, только если view все еще существует
          if (chatViewProvider._view) {
            chatViewProvider._view.webview.postMessage({ 
              command: 'finalizeResponse', 
              id: responseId
            });
          }
          
          // Сохраняем полный ответ в историю чата
          chatViewProvider.addApiResponseToChat('SimpleGPT: ', fullResponse);
        });
      } catch (error: any) {
        vscode.window.showErrorMessage(`Ошибка при отправке запроса: ${error.message}`);
      }
    });
    
    context.subscriptions.push(disposable);
  });
  
  // 3. Обновляем список промптов в чате
  chatViewProvider.refreshPrompts();
}

// Функция для создания безопасного имени команды
function sanitizeCommandName(name: string): string {
  // Заменяем недопустимые символы на подчеркивание
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

export function deactivate() {}
