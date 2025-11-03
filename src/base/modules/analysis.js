// modules/analysis.js
const OpenAI = require('openai');

module.exports = async function analysisModule(ctx, system) {
    // 增加分析索引
    ctx.analysisIndex += 1;
    const currentAnalysisIndex = ctx.analysisIndex;

    // 构建AI消息列表
    const memoryContext = ctx.getMemoryForLLM();
    const enhancedSystemPrompt = memoryContext
        ? `${system.buildSystemPrompt()}\n\n${memoryContext}`
        : system.buildSystemPrompt();

    const messages = [
        { role: 'system', content: enhancedSystemPrompt },
        ...ctx.getRecentHistory(),
    ];

    // 如果是第一次分析，添加用户消息
    if (ctx.analysis.history.length === 0) {
        messages.push({ role: 'user', content: ctx.originalMessage.content });
    }

    try {
        // 获取OpenAI配置
        const openaiConfig = system.openaiConfig || {
            baseURL: '',
            apiKey: '',
            model: '',
        };

        const openai = new OpenAI({
            baseURL: openaiConfig.baseURL,
            apiKey: openaiConfig.apiKey,
        });

        // 发起流式请求
        const stream = await openai.chat.completions.create({
            messages,
            model: openaiConfig.model,
            response_format: { type: 'json_object' },
            stream: true, // 启用流式输出
        });

        let fullThinkingContent = '';
        let fullResponseContent = '';

        // 定义处理输出的函数
        const handleOutput = (type, content) => {
            if (system.onAIMessage) {
                system.onAIMessage({
                    agentId: system.agentId,
                    type,
                    content,
                    index: currentAnalysisIndex,
                });
            } else {
                // Fallback 到控制台输出
                if (type === 'thinking') {
                    process.stdout.write(content);
                } else if (type === 'response') {
                    process.stdout.write(content);
                }
            }
        };

        // 处理流式输出
        for await (const chunk of stream) {
            const thinkingContent = chunk.choices[0]?.delta?.reasoning_content;
            const content = chunk.choices[0]?.delta?.content;

            if (thinkingContent) {
                fullThinkingContent += thinkingContent;
                if (system.streamOutput) {
                    handleOutput('thinking', thinkingContent);
                }
            }

            if (content) {
                fullResponseContent += content;
                if (system.streamOutput) {
                    handleOutput('response', content);
                }
            }
        }

        // 如果不是流式输出但配置了回调，则回调完整内容
        if (!system.streamOutput && system.onAIMessage) {
            system.onAIMessage({
                agentId: system.agentId,
                type: 'complete',
                thinking: fullThinkingContent,
                response: fullResponseContent,
                index: currentAnalysisIndex,
            });
        }

        // 如果没有回调函数且非流式，输出到控制台（向后兼容）
        if (!system.onAIMessage && !system.streamOutput) {
            if (fullThinkingContent) {
                process.stdout.write('\nAI思考: ' + fullThinkingContent);
            }
            if (fullResponseContent) {
                process.stdout.write('\n\nAI响应: ' + fullResponseContent + '\n\n');
            }
        }

        // 保留完整的响应内容供后续使用
        const aiResponse = fullResponseContent;

        ctx.addToHistory('assistant', aiResponse);

        const aiResponseJson = JSON.parse(aiResponse);

        // 解析AI响应为功能调用

        const actions = aiResponseJson.operations;

        if (actions.find(action => action.op === 'utils:leave_world')) {
            ctx.message.finalResponse = actions.find(action => action.op === 'utils:leave_world').params.message;
            ctx.status = 'COMPLETED';
        } else {
            ctx.execution.plan = actions;
            ctx.status = 'EXECUTING';
        }



    } catch (error) {
        console.error('AI调用失败:', error);
        throw new Error(`分析模块错误: ${error.message}`);
    }
};
