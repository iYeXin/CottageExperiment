// agent.js
class ResourceManager {
    constructor() {
        this.resources = new Map(); // 存储资源，key为资源ID，value为资源数据
        this.referenceCounter = new Map(); // 引用计数，用于资源清理
        this.isShuttingDown = false; // 添加关闭状态标识
    }

    // 注册资源，返回资源ID
    registerResource(data, description = '') {
        if (this.isShuttingDown) {
            throw new Error('ResourceManager is shutting down, cannot register new resources');
        }
        const resourceId = this.generateResourceId();
        this.resources.set(resourceId, data);
        this.referenceCounter.set(resourceId, 0);
        return { id: resourceId, description };
    }

    // 获取资源
    getResource(resourceId) {
        if (this.isShuttingDown) {
            return null;
        }
        return this.resources.get(resourceId);
    }

    // 增加资源引用计数
    addReference(resourceId) {
        if (this.isShuttingDown) {
            return;
        }
        if (this.referenceCounter.has(resourceId)) {
            const count = this.referenceCounter.get(resourceId);
            this.referenceCounter.set(resourceId, count + 1);
        }
    }

    // 减少资源引用计数，如果计数为0则删除资源
    releaseReference(resourceId) {
        if (this.referenceCounter.has(resourceId)) {
            const count = this.referenceCounter.get(resourceId) - 1;
            this.referenceCounter.set(resourceId, count);
            if (count <= 0) {
                this.resources.delete(resourceId);
                this.referenceCounter.delete(resourceId);
            }
        }
    }

    // 生成唯一资源ID
    generateResourceId() {
        return `res_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // 清理所有无引用的资源
    cleanup() {
        for (const [resourceId, count] of this.referenceCounter.entries()) {
            if (count <= 0) {
                this.resources.delete(resourceId);
                this.referenceCounter.delete(resourceId);
            }
        }
    }

    // 新增：强制释放所有资源
    forceCleanup() {
        this.resources.clear();
        this.referenceCounter.clear();
    }

    // 新增：关闭资源管理器
    shutdown() {
        this.isShuttingDown = true;
        this.forceCleanup();
    }
}

class RequestContext {
    constructor(msgType, msgContent, senderId, resourceManager, sharedWorld, agentId) {
        this.status = 'PENDING';
        this.originalMessage = {
            time: getNowTime(),
            type: msgType,
            content: msgContent,
            sender: senderId,
        };
        this.analysis = {
            history: [],
            nextAction: null,
        };
        this.execution = {
            plan: [],
            history: [],
        };
        this.message = {
            steps: [],
            finalResponse: null,
        };
        this.error = null;
        this.toolDetailsCache = {};
        this.resourceManager = resourceManager;
        this.resourceReferences = new Map();

        // 新增：共享世界相关
        this.sharedWorld = sharedWorld;
        this.agentId = agentId;
        this.isActive = true;

        // 分析索引和记忆管理
        this.analysisIndex = 0;
        this.memory = {
            permanent: [],
            temporary: [],
            references: new Map()
        };

        this.shouldTerminate = false;

        // 注册到世界事件系统
        this.setupWorldEventListeners();
    }

    // 设置世界事件监听
    setupWorldEventListeners() {
        // 监听实体创建事件
        this.sharedWorld.on('entity_created', (data) => {
            if (this.isActive) {
                this.addTemporaryMemory(`新实体创建: ${data.entity.eid} (${data.entity.type})`, 3);
            }
        });

        // 监听消息接收事件
        this.sharedWorld.on('message_received', (data) => {
            if (data.toAgentId === this.agentId && this.isActive) {
                this.handleIncomingMessage(data.message);
            }
        });
    }

    // 处理传入消息
    handleIncomingMessage(message) {
        const messageText = `[来自 ${message.from}] ${message.content}`;
        this.addToHistory('user', messageText);

        // 如果是思考状态，可以触发重新分析
        if (this.status === 'ANALYZING') {
            this.addTemporaryMemory(`收到新消息: ${message.content}`, 2);
        }
    }

    // 发送消息到其他Agent
    sendMessage(toAgentId, content) {
        this.sharedWorld.sendMessage(toAgentId, {
            content,
            from: this.agentId,
            type: 'agent_message'
        });
    }

    // 广播消息
    broadcastMessage(content) {
        this.sharedWorld.broadcastMessage({
            content,
            from: this.agentId,
            type: 'broadcast_message'
        }, this.agentId);
    }

    // 注册全局实体
    registerGlobalEntity(entityData, description = '') {
        const entityId = this.sharedWorld.registerEntity({
            ...entityData,
            createdBy: this.agentId,
            createdAt: Date.now()
        });

        this.addPermanentMemory(`创建了全局实体: ${description} (${entityId})`);
        return entityId;
    }

    // 获取全局实体
    getGlobalEntity(entityId) {
        return this.sharedWorld.getEntity(entityId);
    }

    isFinished() {
        return this.status === 'COMPLETED' || this.status === 'FAILED' || this.shouldTerminate;
    }

    setError(err) {
        this.error = err;
        this.status = 'FAILED';
    }

    // 新增：设置终止标志
    terminate() {
        this.shouldTerminate = true;
        this.status = 'TERMINATED';
    }

    addToHistory(role, content) {
        const time = getNowTime();
        this.analysis.history.push({ time, role, content });
    }

    getRecentHistory(limit = 15) {
        return this.analysis.history.slice(-limit);
    }

    cacheToolDetail(toolName, detail) {
        this.toolDetailsCache[toolName] = detail;
    }

    getCachedToolDetail(toolName) {
        return this.toolDetailsCache[toolName];
    }

    // 注册资源到ResourceManager，并在Context中记录引用
    registerResource(data, description = '') {
        const { id, description: desc } = this.resourceManager.registerResource(data, description);
        this.resourceReferences.set(id, { description: desc, referenceCount: 1 });
        return id;
    }

    // 获取资源数据
    getResource(resourceId) {
        const resource = this.resourceManager.getResource(resourceId);
        if (resource) {
            // 增加引用计数
            this.resourceManager.addReference(resourceId);
            if (this.resourceReferences.has(resourceId)) {
                const ref = this.resourceReferences.get(resourceId);
                ref.referenceCount += 1;
            } else {
                this.resourceReferences.set(resourceId, { description: '', referenceCount: 1 });
            }
        }
        return resource;
    }

    // 释放资源引用
    releaseResource(resourceId) {
        if (this.resourceReferences.has(resourceId)) {
            const ref = this.resourceReferences.get(resourceId);
            ref.referenceCount -= 1;
            if (ref.referenceCount <= 0) {
                this.resourceReferences.delete(resourceId);
            }
            this.resourceManager.releaseReference(resourceId);
        }
    }

    // 获取所有资源引用信息
    getResourceReferences() {
        return Array.from(this.resourceReferences.entries()).map(([id, ref]) => ({
            id,
            description: ref.description,
            referenceCount: ref.referenceCount,
        }));
    }

    // 新增：释放所有资源
    releaseAllResources() {
        for (const [resourceId, ref] of this.resourceReferences.entries()) {
            for (let i = 0; i < ref.referenceCount; i++) {
                this.resourceManager.releaseReference(resourceId);
            }
        }
        this.resourceReferences.clear();
    }

    // 添加永久记忆
    addPermanentMemory(content) {
        this.memory.permanent.push({
            content,
            timestamp: getNowTime()
        });
    }

    // 添加临时记忆
    addTemporaryMemory(content, expireAfterTurns = 2) {
        this.memory.temporary.push({
            content,
            expireAfterTurns,
            addedAtTurn: this.getCurrentTurnCount()
        });
    }

    // 添加引用记忆
    addReferenceMemory(description, resourceId) {
        this.memory.references.set(resourceId, {
            description,
            timestamp: getNowTime()
        });
    }

    // 获取当前应该注入LLM的记忆
    getMemoryForLLM() {
        const memoryContext = [];

        // 添加永久记忆
        if (this.memory.permanent.length > 0) {
            memoryContext.push("## 永久记忆:");
            this.memory.permanent.forEach((mem, index) => {
                memoryContext.push(`${index + 1}. ${mem.content} (${mem.timestamp})`);
            });
        }

        // 添加临时记忆（未过期的）
        const currentTurn = this.getCurrentTurnCount();
        const validTemporary = this.memory.temporary.filter(
            mem => currentTurn - mem.addedAtTurn < mem.expireAfterTurns
        );

        if (validTemporary.length > 0) {
            memoryContext.push("## 临时记忆:");
            validTemporary.forEach((mem, index) => {
                memoryContext.push(`${index + 1}. ${mem.content}`);
            });
        }

        // 添加引用记忆信息（不包含具体数据，只包含描述和引用符）
        if (this.memory.references.size > 0) {
            memoryContext.push("## 可用引用记忆:");
            this.memory.references.forEach((info, resourceId) => {
                memoryContext.push(`- ${resourceId}: ${info.description} (${info.timestamp})`);
            });
        }

        return memoryContext.join('\n');
    }

    // 获取当前轮次计数（可以根据分析历史长度估算）
    getCurrentTurnCount() {
        return Math.floor(this.analysis.history.length / 2); // 每轮对话通常有用户和助手两条消息
    }

    // 清理过期的临时记忆
    cleanupExpiredMemory() {
        const currentTurn = this.getCurrentTurnCount();
        this.memory.temporary = this.memory.temporary.filter(
            mem => currentTurn - mem.addedAtTurn < mem.expireAfterTurns
        );
    }
}

class AIAgentSystem {
    constructor(options) {
        // 必需参数验证
        if (!options.msgType || !options.msgContent || !options.senderId) {
            throw new Error('Missing required parameters: msgType, msgContent, senderId');
        }
        if (!options.modules || !options.modules.analysis || !options.modules.execution || !options.modules.message) {
            throw new Error('Missing required modules: analysis, execution, message');
        }
        if (!options.openaiConfig) {
            throw new Error('Missing required parameter: openaiConfig');
        }

        this.msgType = options.msgType;
        this.msgContent = options.msgContent;
        this.senderId = options.senderId;

        // 配置参数
        this.maxRecursionDepth = options.maxRecursionDepth || 100;
        this.timeoutMs = options.timeoutMs || 3000000;
        this.systemPrompt = options.systemPrompt || null;
        this.tools = options.tools || [];
        this.openaiConfig = options.openaiConfig;

        // 新增配置选项
        this.onAIMessage = options.onAIMessage || null;
        this.streamOutput = options.streamOutput !== undefined ? options.streamOutput : true;

        // 动态模块
        this.modules = options.modules;

        // 共享世界集成
        this.sharedWorld = options.sharedWorld;
        this.agentId = options.agentId || `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.role = options.role || 'general'; // Agent角色

        // 初始化ResourceManager
        this.resourceManager = new ResourceManager();

        // 存储工具列表和执行器映射
        this.tools = options.tools || [];
        this.executorMap = options.executorMap || {};

        // 初始化Context - 传入共享世界和Agent ID
        this.ctx = new RequestContext(
            this.msgType,
            this.msgContent,
            this.senderId,
            this.resourceManager,
            this.sharedWorld,
            this.agentId
        );

        // 初始化分析索引
        this.ctx.analysisIndex = 0;

        // 在Context中添加获取工具和执行器映射的方法
        this.ctx.getTools = () => this.tools;
        this.ctx.getExecutorMap = () => this.executorMap;

        // 终止标志和清理回调
        this.isTerminating = false;
        this.cleanupCallbacks = [];

        // 注册到共享世界
        this.registerToWorld();
    }

    // 注册到共享世界
    registerToWorld() {
        if (this.sharedWorld) {
            this.sharedWorld.registerAgent(this.agentId, this);
            console.log(`Agent ${this.agentId} 已注册到共享世界，角色: ${this.role}`);
        }
    }

    async start() {
        // 注册到世界后开始处理
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`处理超时 (${this.timeoutMs}ms)`)), this.timeoutMs);
        });

        try {
            const result = await Promise.race([this.runCycle(0), timeoutPromise]);
            return result;
        } catch (error) {
            this.ctx.setError(error);
            await this.modules.message(this.ctx);
            return this.buildFinalResponse();
        }
    }

    async runCycle(recursionDepth) {
        // 检查终止条件
        if (this.isTerminating || this.ctx.shouldTerminate) {
            await this.performCleanup();
            return this.buildFinalResponse();
        }

        if (recursionDepth > this.maxRecursionDepth) {
            throw new Error(`超过最大递归深度: ${this.maxRecursionDepth}`);
        }
        if (this.ctx.isFinished()) {
            return this.buildFinalResponse();
        }

        // 检查是否有来自其他Agent的消息
        await this.processIncomingMessages();

        switch (this.ctx.status) {
            case 'PENDING':
                this.ctx.status = 'ANALYZING';
            case 'ANALYZING':
                await this.modules.analysis(this.ctx, this);
                break;
            case 'EXECUTING':
                await this.modules.execution(this.ctx);
                break;
            default:
                throw new Error(`未知状态: ${this.ctx.status}`);
        }

        await this.modules.message(this.ctx);
        return await this.runCycle(recursionDepth + 1);
    }

    // 处理来自其他Agent的消息
    async processIncomingMessages() {
        if (!this.sharedWorld) return;

        const messages = this.sharedWorld.getMessages(this.agentId);
        for (const message of messages) {
            // 将消息添加到分析历史
            this.ctx.addToHistory('user', `[来自 ${message.from}] ${message.content}`);

            // 根据消息类型处理
            if (message.type === 'agent_message') {
                this.ctx.addTemporaryMemory(`收到Agent ${message.from}的消息: ${message.content}`, 3);
            }
        }
    }

    // 发送消息到其他Agent
    sendMessage(toAgentId, content) {
        if (this.sharedWorld) {
            this.sharedWorld.sendMessage(toAgentId, {
                content,
                from: this.agentId,
                type: 'agent_message'
            });
        }
    }

    // 广播消息
    broadcastMessage(content) {
        if (this.sharedWorld) {
            this.sharedWorld.broadcastMessage({
                content,
                from: this.agentId,
                type: 'broadcast_message'
            }, this.agentId);
        }
    }


    buildFinalResponse() {
        return this.ctx.message.finalResponse;
    }

    // 获取资源管理器实例，便于外部访问
    getResourceManager() {
        return this.resourceManager;
    }

    // 获取上下文实例，便于外部访问
    getContext() {
        return this.ctx;
    }

    // 构建系统提示
    buildSystemPrompt() {
        if (!this.systemPrompt) {
            return '你是一个智能AI助手';
        }
        let prompt = this.systemPrompt;
        prompt = prompt.replace('{{ INITIAL_INPUT }}', this.msgContent);
        return prompt;
    }

    // 新增：退出方法 - 终止agent循环并释放资源
    async exit() {
        if (this.isTerminating) {
            return; // 防止重复调用
        }

        this.isTerminating = true;
        this.ctx.terminate();

        await this.performCleanup();

        return {
            status: 'TERMINATED',
            message: 'Agent已终止',
            resourcesReleased: true,
            terminationTime: getNowTime()
        };
    }

    // 新增：执行清理操作
    async performCleanup() {
        try {
            // 释放上下文中的所有资源
            this.ctx.releaseAllResources();

            // 关闭资源管理器
            this.resourceManager.shutdown();

            // 执行注册的清理回调
            for (const callback of this.cleanupCallbacks) {
                try {
                    await callback();
                } catch (error) {
                    console.error('清理回调执行失败:', error);
                }
            }

            // 清空回调列表
            this.cleanupCallbacks = [];

        } catch (error) {
            console.error('资源清理过程中发生错误:', error);
        }
    }

    // 新增：注册清理回调
    onCleanup(callback) {
        if (typeof callback === 'function') {
            this.cleanupCallbacks.push(callback);
        }
    }

    // 新增：强制立即退出（不等待当前循环结束）
    forceExit() {
        this.isTerminating = true;
        this.ctx.terminate();
        this.performCleanup().catch(console.error);

        return {
            status: 'FORCE_TERMINATED',
            message: 'Agent已强制终止',
            forceExit: true,
            terminationTime: getNowTime()
        };
    }
}

function getNowTime() {
    const now = new Date();
    const formattedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    return formattedDate;
}

module.exports = {
    AIAgentSystem,
    RequestContext,
    ResourceManager,
};