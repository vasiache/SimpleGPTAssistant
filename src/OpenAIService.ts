import * as vscode from 'vscode';
import axios from 'axios';

export class OpenAIService {
  private static readonly DEFAULT_API_URL = 'https://api.openai.com/v1/chat/completions';
  private static readonly DEFAULT_MODEL = 'gpt-3.5-turbo';

  public async sendRequest(
    systemPrompt: string, 
    userContent: string, 
    onPartialResponse?: (text: string) => void
  ): Promise<string> {
    const config = vscode.workspace.getConfiguration('simplegpt');
    let apiKey = config.get<string>('apiKey');
    let apiUrl = config.get<string>('apiUrl');
    let model = config.get<string>('model');
    
    // Проверяем и запрашиваем API ключ при необходимости
    if (!apiKey) {
      apiKey = await this.promptForAPIKey();
      if (!apiKey) {
        throw new Error('API ключ не предоставлен');
      }
    }
    
    // Валидация API ключа (базовая проверка)
    if (apiKey.trim().length < 10 || !apiKey.startsWith('sk-')) {
      const resetKey = await vscode.window.showErrorMessage(
        'API ключ выглядит некорректным. API ключи OpenAI обычно начинаются с "sk-" и содержат не менее 30 символов.',
        'Сбросить ключ',
        'Продолжить'
      );
      
      if (resetKey === 'Сбросить ключ') {
        apiKey = await this.promptForAPIKey();
        if (!apiKey) {
          throw new Error('API ключ не предоставлен');
        }
      }
    }
    
    // Проверяем и запрашиваем URL API при необходимости
    if (!apiUrl) {
      apiUrl = await this.promptForAPIUrl();
      if (!apiUrl) {
        apiUrl = OpenAIService.DEFAULT_API_URL;
        await config.update('apiUrl', apiUrl, true);
        vscode.window.showInformationMessage(`Установлен URL по умолчанию: ${apiUrl}`);
      }
    }
    
    // Проверяем и запрашиваем модель при необходимости
    if (!model) {
      model = await this.promptForModel();
      if (!model) {
        model = OpenAIService.DEFAULT_MODEL;
        await config.update('model', model, true);
        vscode.window.showInformationMessage(`Установлена модель по умолчанию: ${model}`);
      }
    }
    
    try {
      // Если передан колбэк для частичных ответов, используем стриминг
      if (onPartialResponse) {
        return await this.streamingRequest(apiUrl, apiKey, model, systemPrompt, userContent, onPartialResponse);
      } else {
        // Иначе используем обычный запрос
        return await this.regularRequest(apiUrl, apiKey, model, systemPrompt, userContent);
      }
    } catch (error: any) {
      console.error('OpenAI API Error:', error);
      
      if (error.response) {
        const statusCode = error.response.status;
        const errorData = error.response.data;
        
        // Обработка конкретных ошибок API
        if (statusCode === 401) {
          // Неверный API ключ
          const resetKey = await vscode.window.showErrorMessage(
            'Неверный API ключ. Пожалуйста, проверьте ваш ключ на странице https://platform.openai.com/account/api-keys.',
            'Изменить ключ'
          );
          
          if (resetKey === 'Изменить ключ') {
            await this.promptForAPIKey();
            throw new Error('API ключ был изменен. Пожалуйста, попробуйте отправить запрос снова.');
          }
        } else if (statusCode === 429) {
          // Превышение лимита запросов
          throw new Error('Превышен лимит запросов к API. Пожалуйста, попробуйте позже или проверьте ваш тарифный план.');
        } else if (statusCode === 404) {
          // Неверный URL или модель
          const errorMessage = errorData.error?.message || 'Ресурс не найден. Проверьте URL API и название модели.';
          throw new Error(`Ошибка 404: ${errorMessage}`);
        } else {
          // Другие ошибки API
          const errorMessage = errorData.error?.message || JSON.stringify(errorData);
          throw new Error(`API Error (${statusCode}): ${errorMessage}`);
        }
      } else if (error.request) {
        // Ошибка сети
        throw new Error('Не получен ответ от API. Проверьте подключение к интернету и URL API.');
      } else {
        // Другие ошибки
        throw new Error(`Ошибка: ${error.message}`);
      }
      
      // Убедимся, что функция всегда возвращает строку или выбрасывает исключение
      throw new Error('Произошла непредвиденная ошибка при обращении к API');
    }
  }

  // Обычный запрос без стриминга
  private async regularRequest(
    apiUrl: string, 
    apiKey: string, 
    model: string, 
    systemPrompt: string, 
    userContent: string
  ): Promise<string> {
    const response = await axios.post(
      apiUrl,
      {
        model: model,
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: userContent
          }
        ],
        temperature: 0.7,
        max_tokens: 1000
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        }
      }
    );
    
    return response.data.choices[0].message.content;
  }

  // Запрос с потоковой передачей данных
  private async streamingRequest(
    apiUrl: string, 
    apiKey: string, 
    model: string, 
    systemPrompt: string, 
    userContent: string,
    onPartialResponse: (text: string) => void
  ): Promise<string> {
    let fullResponse = '';
    
    try {
      const response = await axios.post(
        apiUrl,
        {
          model: model,
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: userContent
            }
          ],
          temperature: 0.7,
          max_tokens: 1000,
          stream: true
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          responseType: 'stream'
        }
      );
      
      return new Promise((resolve, reject) => {
        let buffer = '';
        
        response.data.on('data', (chunk: Buffer) => {
          const chunkText = chunk.toString();
          buffer += chunkText;
          
          // Обрабатываем полученные строки
          while (buffer.includes('\n')) {
            const lineEndIndex = buffer.indexOf('\n');
            const line = buffer.substring(0, lineEndIndex).trim();
            buffer = buffer.substring(lineEndIndex + 1);
            
            if (line.startsWith('data: ')) {
              const data = line.substring(6);
              
              // Проверяем, не конец ли это потока
              if (data === '[DONE]') {
                resolve(fullResponse);
                return;
              }
              
              try {
                const jsonData = JSON.parse(data);
                const content = jsonData.choices[0]?.delta?.content;
                
                if (content) {
                  fullResponse += content;
                  onPartialResponse(content);
                }
              } catch (e) {
                console.error('Error parsing JSON from stream:', e);
              }
            }
          }
        });
        
        response.data.on('end', () => {
          resolve(fullResponse);
        });
        
        response.data.on('error', (err: Error) => {
          reject(err);
        });
      });
    } catch (error) {
      console.error('Streaming error:', error);
      throw error;
    }
  }
  
  private async promptForAPIKey(): Promise<string | undefined> {
    const apiKey = await vscode.window.showInputBox({
      prompt: 'Введите ваш OpenAI API ключ (начинается с "sk-")',
      password: true,
      placeHolder: 'sk-...',
      validateInput: (value) => {
        if (!value) {
          return 'API ключ не может быть пустым';
        }
        if (!value.startsWith('sk-')) {
          return 'API ключ OpenAI обычно начинается с "sk-"';
        }
        if (value.length < 30) {
          return 'API ключ OpenAI обычно содержит не менее 30 символов';
        }
        return null;
      }
    });
    
    if (apiKey) {
      await vscode.workspace.getConfiguration('simplegpt').update('apiKey', apiKey, true);
      vscode.window.showInformationMessage('API ключ сохранен');
    }
    
    return apiKey;
  }
  
  private async promptForAPIUrl(): Promise<string | undefined> {
    const apiUrl = await vscode.window.showInputBox({
      prompt: 'Введите URL OpenAI API',
      value: OpenAIService.DEFAULT_API_URL,
      placeHolder: 'https://api.openai.com/v1/chat/completions',
      validateInput: (value) => {
        if (!value) {
          return 'URL не может быть пустым';
        }
        try {
          new URL(value);
          return null;
        } catch (e) {
          return 'Введите корректный URL';
        }
      }
    });
    
    if (apiUrl) {
      await vscode.workspace.getConfiguration('simplegpt').update('apiUrl', apiUrl, true);
      vscode.window.showInformationMessage('API URL сохранен');
    }
    
    return apiUrl;
  }
  
  private async promptForModel(): Promise<string | undefined> {
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
      await vscode.workspace.getConfiguration('simplegpt').update('model', model, true);
      vscode.window.showInformationMessage(`Модель ${model} сохранена`);
    }
    
    return model;
  }
  
  // Метод для сброса API ключа
  public async resetApiKey(): Promise<void> {
    await vscode.workspace.getConfiguration('simplegpt').update('apiKey', undefined, true);
    vscode.window.showInformationMessage('API ключ сброшен');
  }
}
