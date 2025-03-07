import * as vscode from 'vscode';
import { PromptManager } from './PromptManager';
import { OpenAIService } from './OpenAIService';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public _view?: vscode.WebviewView;
  private _chatHistory: string[] = []; // Для хранения истории сообщений
  private _chats: { id: string, name: string, messages: string[] }[] = [
    { id: 'default', name: 'Новый чат', messages: [] }
  ]; // Список чатов
  private _currentChatId: string = 'default'; // ID текущего чата
  
  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _promptManager: PromptManager,
    private readonly _openAIService: OpenAIService
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;
    
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Обработка сообщений от webview
    webviewView.webview.onDidReceiveMessage(
      async message => {
        switch (message.command) {
          case 'sendMessage':
            try {
              let systemPrompt = "You are a helpful assistant.";
              let userContent = message.text;
              
              // Проверяем, выбран ли промпт
              if (message.selectedPrompt) {
                systemPrompt = this._promptManager.getPromptContent(message.selectedPrompt) || systemPrompt;
                this.addMessageToChat(`Используется промпт: ${message.selectedPrompt}`);
              }
              
              this.addMessageToChat(`Вы: ${userContent}`);
              
              // Создаем элемент для ответа
              const responseId = `response-${Date.now()}`;
              this._view!.webview.postMessage({ 
                command: 'createResponseElement', 
                id: responseId,
                prefix: 'SimpleGPT: '
              });
              
              try {
                // Переменная для сбора полного ответа
                let fullResponse = '';
                
                await this._openAIService.sendRequest(
                  systemPrompt, 
                  userContent, 
                  (partialResponse) => {
                    // Добавляем к полному ответу
                    fullResponse += partialResponse;
                    
                    // Отправляем частичный ответ
                    this._view!.webview.postMessage({ 
                      command: 'appendToElement', 
                      id: responseId,
                      text: partialResponse
                    });
                  }
                );
                
                // Завершаем ответ
                this._view!.webview.postMessage({ 
                  command: 'finalizeResponse', 
                  id: responseId
                });
                
                // Сохраняем полный ответ в историю чата
                this.addApiResponseToChat('SimpleGPT: ', fullResponse);
              } catch (error: any) {
                // В случае ошибки
                this._view!.webview.postMessage({ 
                  command: 'appendToElement', 
                  id: responseId,
                  text: `\n\nОшибка: ${error.message}`
                });
                
                vscode.window.showErrorMessage(`Ошибка: ${error.message}`);
              }
            } catch (error: any) {
              vscode.window.showErrorMessage(`Ошибка: ${error.message}`);
              this.addMessageToChat(`Ошибка: ${error.message}`);
            }
            return;
            
          case 'executeCommand':
            // Выполнение команд из webview
            if (message.commandId) {
              vscode.commands.executeCommand(message.commandId);
            }
            return;
            
          case 'newChat':
            this.createNewChat();
            return;
            
          case 'deleteChat':
            if (message.chatId) {
              this.deleteChat(message.chatId);
            }
            return;
            
          case 'switchChat':
            if (message.chatId) {
              this.switchChat(message.chatId);
            }
            return;
            
          case 'renameChatRequest':
            if (message.chatId) {
              this.showRenameChatDialog(message.chatId);
            }
            return;
            
          case 'requestPromptsList':
            // Ответ на запрос списка промптов
            this.refreshPrompts();
            return;
            
          case 'requestChatsList':
            // Ответ на запрос списка чатов
            this.refreshChats();
            return;
        }
      },
      undefined
    );
    
    // Восстанавливаем историю чата после небольшой задержки
    setTimeout(() => {
      this.refreshChats(); // Сначала обновляем список чатов
      this._restoreChatHistory(); // Затем восстанавливаем историю текущего чата
      this.refreshPrompts(); // Явно обновляем список промптов при каждом открытии
    }, 300);
  }
  
  // Метод для показа диалога переименования чата
  public async showRenameChatDialog(chatId: string): Promise<void> {
    const chat = this._chats.find(c => c.id === chatId);
    if (!chat) return;
    
    const newName = await vscode.window.showInputBox({
      placeHolder: 'Введите новое название чата',
      prompt: 'Переименование чата',
      value: chat.name
    });
    
    if (newName !== undefined && newName.trim() !== '') {
      this.renameChat(chatId, newName.trim());
    }
  }
  
  // Метод для переименования чата
  public renameChat(chatId: string, newName: string): void {
    const chat = this._chats.find(c => c.id === chatId);
    if (!chat) return;
    
    chat.name = newName;
    this.refreshChats();
  }
  
  // Метод для создания нового чата
  public async createNewChat(): Promise<void> {
    const chatId = `chat-${Date.now()}`;
    
    const chatName = await vscode.window.showInputBox({
      placeHolder: 'Введите название нового чата',
      prompt: 'Создание нового чата',
      value: `Чат ${this._chats.length + 1}`
    });
    
    if (chatName === undefined) return; // Пользователь отменил ввод
    
    const finalChatName = chatName.trim() !== '' ? chatName.trim() : `Чат ${this._chats.length + 1}`;
    
    this._chats.push({
      id: chatId,
      name: finalChatName,
      messages: []
    });
    
    this.switchChat(chatId);
    this.refreshChats();
  }
  
  // Метод для удаления чата
  public deleteChat(chatId: string): void {
    // Проверяем, не пытаемся ли удалить единственный чат
    if (this._chats.length <= 1) {
      vscode.window.showInformationMessage('Нельзя удалить единственный чат');
      return;
    }
    
    const chatIndex = this._chats.findIndex(chat => chat.id === chatId);
    if (chatIndex === -1) return;
    
    // Удаляем чат
    this._chats.splice(chatIndex, 1);
    
    // Если удалили текущий чат, переключаемся на первый доступный
    if (this._currentChatId === chatId) {
      this._currentChatId = this._chats[0].id;
      this._restoreChatHistory();
    }
    
    this.refreshChats();
  }
  
  // Метод для переключения между чатами
  public switchChat(chatId: string): void {
    if (this._currentChatId === chatId) return;
    
    const chatExists = this._chats.some(chat => chat.id === chatId);
    if (!chatExists) return;
    
    this._currentChatId = chatId;
    this._restoreChatHistory();
    
    this.refreshChats(); // Обновляем список чатов с новым активным чатом
  }
  
  // Метод для обновления списка чатов в интерфейсе
  public refreshChats(): void {
    if (this._view) {
      this._view.webview.postMessage({
        command: 'updateChats',
        chats: this._chats.map(chat => ({
          id: chat.id,
          name: chat.name,
          isActive: chat.id === this._currentChatId
        }))
      });
    }
  }
  
  // Метод для восстановления истории чата
  private _restoreChatHistory(): void {
    if (!this._view) return;
    
    // Находим текущий чат
    const currentChat = this._chats.find(chat => chat.id === this._currentChatId);
    if (!currentChat) return;
    
    // Обновляем локальную историю сообщений
    this._chatHistory = [...currentChat.messages];
    
    // Отправляем историю в webview
    this._view.webview.postMessage({
      command: 'clearChat'
    });
    
    if (this._chatHistory.length > 0) {
      this._view.webview.postMessage({
        command: 'restoreChatHistory',
        messages: this._chatHistory
      });
    }
  }
  
  public addMessageToChat(message: string): void {
    // Находим текущий чат
    const currentChat = this._chats.find(chat => chat.id === this._currentChatId);
    if (!currentChat) return;
    
    // Сохраняем сообщение в истории текущего чата
    currentChat.messages.push(message);
    this._chatHistory = currentChat.messages;
    
    if (this._view) {
      this._view.webview.postMessage({ 
        command: 'receiveMessage', 
        text: message 
      });
    }
  }
  
  // Метод для сохранения ответа API в истории
  public addApiResponseToChat(prefix: string, content: string): void {
    // Находим текущий чат
    const currentChat = this._chats.find(chat => chat.id === this._currentChatId);
    if (!currentChat) return;
    
    // Сохраняем сообщение в истории текущего чата
    currentChat.messages.push(`${prefix}${content}`);
    this._chatHistory = currentChat.messages;
  }
  
  // Метод для очистки истории чата
  public clearChatHistory(): void {
    // Находим текущий чат
    const currentChat = this._chats.find(chat => chat.id === this._currentChatId);
    if (!currentChat) return;
    
    // Очищаем историю текущего чата
    currentChat.messages = [];
    this._chatHistory = [];
    
    if (this._view) {
      this._view.webview.postMessage({ 
        command: 'clearChat' 
      });
    }
  }
  
  public refreshPrompts(): void {
    if (this._view) {
      const prompts = this._promptManager.getPrompts();
      this._view.webview.postMessage({
        command: 'updatePrompts',
        prompts: Object.keys(prompts)
      });
      
      // Добавляем логирование для отладки
      console.log(`Обновление списка промптов: ${Object.keys(prompts).length} промптов отправлено в webview`);
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>SimpleGPT Chat</title>
        <style>
          body {
            padding: 10px;
            color: var(--vscode-foreground);
            font-family: var(--vscode-font-family);
            background-color: var(--vscode-editor-background);
            display: flex;
            flex-direction: column;
            height: 100vh;
            margin: 0;
          }
          
          .container {
            display: flex;
            flex-grow: 1;
            flex-direction: column;
          }
          
          .settings-bar {
            display: flex;
            margin-bottom: 10px;
            gap: 5px;
            flex-wrap: wrap;
          }
          
          .settings-button {
            padding: 4px 8px;
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
          }
          
          .settings-button:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
          }
          
          .new-chat-button {
            padding: 4px 8px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
          }
          
          .new-chat-button:hover {
            background-color: var(--vscode-button-hoverBackground);
          }
          
          .delete-chat-button, .rename-chat-button {
            padding: 4px 8px;
            background-color: var(--vscode-errorForeground);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
          }
          
          .rename-chat-button {
            background-color: var(--vscode-warningBackground);
            color: var(--vscode-warningForeground);
          }
          
          .delete-chat-button:hover, .rename-chat-button:hover {
            opacity: 0.8;
          }
          
          .chat-controls {
            display: flex;
            gap: 5px;
            margin-bottom: 10px;
          }
          
          .prompts-container {
            margin-bottom: 10px;
          }
          
          .prompts-label {
            margin-bottom: 5px;
            font-weight: bold;
          }
          
          #prompts-list, #chats-list {
            width: 100%;
            padding: 5px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            margin-bottom: 10px;
          }
          
          .chat-output {
            flex-grow: 1;
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 8px;
            margin-bottom: 10px;
            overflow-y: auto;
            background-color: var(--vscode-input-background);
          }
          
          .input-container {
            display: flex;
          }
          
          #message-input {
            flex-grow: 1;
            padding: 6px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
          }
          
          #send-button {
            margin-left: 5px;
            padding: 6px 12px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
          }
          
          #send-button:hover {
            background-color: var(--vscode-button-hoverBackground);
          }
          
          .message {
            margin-bottom: 8px;
            padding: 8px;
            border-radius: 4px;
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            white-space: pre-wrap;
          }
          
          .streaming {
            border-left: 3px solid var(--vscode-activityBarBadge-background);
            animation: pulse 1.5s infinite;
          }
          
          @keyframes pulse {
            0% {
              opacity: 1;
            }
            50% {
              opacity: 0.8;
            }
            100% {
              opacity: 1;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="settings-bar">
            <button class="settings-button" id="add-prompt">Add Prompt</button>
            <button class="settings-button" id="delete-prompt">Delete Prompt</button>
            <button class="settings-button" id="set-api-url">Set API URL</button>
            <button class="settings-button" id="set-model">Set Model</button>
          </div>
          
          <div class="prompts-container">
            <div class="prompts-label">Выберите чат:</div>
            <select id="chats-list">
              
            </select>
            
            <div class="chat-controls">
              <button class="new-chat-button" id="new-chat">Новый чат</button>
              <button class="rename-chat-button" id="rename-chat">Переименовать</button>
              <button class="delete-chat-button" id="delete-chat">Удалить чат</button>
            </div>
            
            <div class="prompts-label">Выберите промпт:</div>
            <select id="prompts-list">
              <option value="">Без промпта</option>
            </select>
          </div>
          
          <div class="chat-output" id="chat-output"></div>
          
          <div class="input-container">
            <input type="text" id="message-input" placeholder="Введите сообщение..." />
            <button id="send-button">Отправить</button>
          </div>
        </div>
        
        <script>
          const vscode = acquireVsCodeApi();
          const chatOutput = document.getElementById('chat-output');
          const messageInput = document.getElementById('message-input');
          const sendButton = document.getElementById('send-button');
          const promptsList = document.getElementById('prompts-list');
          const chatsList = document.getElementById('chats-list');
          const addPromptButton = document.getElementById('add-prompt');
          const deletePromptButton = document.getElementById('delete-prompt');
          const setApiUrlButton = document.getElementById('set-api-url');
          const setModelButton = document.getElementById('set-model');
          const newChatButton = document.getElementById('new-chat');
          const deleteChatButton = document.getElementById('delete-chat');
          const renameChatButton = document.getElementById('rename-chat');
          
          // Запрашиваем список промптов и чатов при загрузке
          window.addEventListener('load', () => {
            vscode.postMessage({
              command: 'requestPromptsList'
            });
            
            vscode.postMessage({
              command: 'requestChatsList'
            });
          });
          
          // Функция отправки сообщения
          function sendMessage() {
            const text = messageInput.value.trim();
            const selectedPrompt = promptsList.value;
            
            if (text) {
              vscode.postMessage({
                command: 'sendMessage',
                text: text,
                selectedPrompt: selectedPrompt
              });
              messageInput.value = '';
            }
          }
          
          // Обработчики событий
          sendButton.addEventListener('click', sendMessage);
          
          messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
              sendMessage();
            }
          });
          
          // Обработчик переключения чата
          chatsList.addEventListener('change', () => {
            const selectedChatId = chatsList.value;
            if (selectedChatId) {
              vscode.postMessage({
                command: 'switchChat',
                chatId: selectedChatId
              });
            }
          });
          
          // Обработчик переименования чата
          renameChatButton.addEventListener('click', () => {
            const selectedChatId = chatsList.value;
            if (selectedChatId) {
              vscode.postMessage({
                command: 'renameChatRequest',
                chatId: selectedChatId
              });
            }
          });
          
          // Кнопки настроек
          addPromptButton.addEventListener('click', () => {
            vscode.postMessage({
              command: 'executeCommand',
              commandId: 'simplegpt.addPrompt'
            });
          });
          
          deletePromptButton.addEventListener('click', () => {
            vscode.postMessage({
              command: 'executeCommand',
              commandId: 'simplegpt.deletePrompt'
            });
          });
          
          setApiUrlButton.addEventListener('click', () => {
            vscode.postMessage({
              command: 'executeCommand',
              commandId: 'simplegpt.setApiUrl'
            });
          });
          
          setModelButton.addEventListener('click', () => {
            vscode.postMessage({
              command: 'executeCommand',
              commandId: 'simplegpt.setModel'
            });
          });
          
          newChatButton.addEventListener('click', () => {
            vscode.postMessage({
              command: 'newChat'
            });
          });
          
          deleteChatButton.addEventListener('click', () => {
            const selectedChatId = chatsList.value;
            if (selectedChatId && confirm('Вы уверены, что хотите удалить этот чат?')) {
              vscode.postMessage({
                command: 'deleteChat',
                chatId: selectedChatId
              });
            }
          });
          
          // Обработка сообщений от расширения
          window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
              case 'receiveMessage':
                const messageElement = document.createElement('div');
                messageElement.className = 'message';
                messageElement.textContent = message.text;
                chatOutput.appendChild(messageElement);
                
                // Прокрутка вниз для отображения нового сообщения
                chatOutput.scrollTop = chatOutput.scrollHeight;
                break;
                
              case 'createResponseElement':
                const responseElement = document.createElement('div');
                responseElement.className = 'message streaming';
                responseElement.id = message.id;
                responseElement.textContent = message.prefix || '';
                chatOutput.appendChild(responseElement);
                chatOutput.scrollTop = chatOutput.scrollHeight;
                break;
                
              case 'appendToElement':
                const element = document.getElementById(message.id);
                if (element) {
                  element.textContent += message.text;
                  chatOutput.scrollTop = chatOutput.scrollHeight;
                }
                break;
                
              case 'finalizeResponse':
                const finishedElement = document.getElementById(message.id);
                if (finishedElement) {
                  finishedElement.classList.remove('streaming');
                }
                break;
                
              case 'clearChat':
                // Очищаем содержимое чата
                chatOutput.innerHTML = '';
                break;
            
              case 'restoreChatHistory':
                // Восстанавливаем историю сообщений
                if (message.messages && message.messages.length > 0) {
                  message.messages.forEach(msg => {
                    const messageElement = document.createElement('div');
                    messageElement.className = 'message';
                    messageElement.textContent = msg;
                    chatOutput.appendChild(messageElement);
                  });
                  // Прокрутка вниз
                  chatOutput.scrollTop = chatOutput.scrollHeight;
                }
                break;
            
              case 'updatePrompts':
                // Сохраняем текущий выбранный промпт
                const currentSelectedPrompt = promptsList.value;
                
                // Очистка списка промптов (кроме первого пустого варианта)
                while (promptsList.options.length > 1) {
                  promptsList.remove(1);
                }
                
                // Добавление промптов из списка
                if (message.prompts && message.prompts.length > 0) {
                  console.log("Получены промпты:", message.prompts);
                  message.prompts.forEach(prompt => {
                    const option = document.createElement('option');
                    option.value = prompt;
                    option.textContent = prompt;
                    promptsList.appendChild(option);
                  });
                  
                  // Восстанавливаем выбранный промпт, если он всё ещё существует
                  if (currentSelectedPrompt) {
                    for (let i = 0; i < promptsList.options.length; i++) {
                      if (promptsList.options[i].value === currentSelectedPrompt) {
                        promptsList.selectedIndex = i;
                        break;
                      }
                    }
                  }
                }
                break;
                
              case 'updateChats':
                // Сохраняем текущий выбранный чат
                const currentSelectedChat = chatsList.value;
                
                // Очистка списка чатов
                while (chatsList.options.length > 0) {
                  chatsList.remove(0);
                }
                
                // Добавление чатов из списка
                if (message.chats && message.chats.length > 0) {
                  message.chats.forEach(chat => {
                    const option = document.createElement('option');
                    option.value = chat.id;
                    option.textContent = chat.name;
                    if (chat.isActive) {
                      option.selected = true;
                    }
                    chatsList.appendChild(option);
                  });
                }
                break;
            }
          });
        </script>
      </body>
      </html>
    `;
  }
}
