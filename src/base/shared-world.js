class SharedWorld {
    constructor() {
        this.agents = new Map(); // 存储所有注册的Agent
        this.globalEntities = new Map(); // 全局实体存储
        this.eventListeners = new Map(); // 事件监听器
        this.messageQueue = new Map(); // 按Agent分组的消息队列
        this.isRunning = true;

        // 启动世界事件循环
        this.startEventLoop();
    }

    // 注册Agent到世界
    registerAgent(agentId, agentInstance) {
        this.agents.set(agentId, agentInstance);
        this.messageQueue.set(agentId, []);
        console.log(`居民 ${agentId} 已加入共享世界`);
    }

    // 注销Agent
    unregisterAgent(agentId) {
        this.agents.delete(agentId);
        this.messageQueue.delete(agentId);
        console.log(`居民 ${agentId} 已离开共享世界`);
    }

    // 发送消息给特定Agent
    sendMessage(toAgentId, message) {
        if (this.messageQueue.has(toAgentId)) {
            this.messageQueue.get(toAgentId).push({
                ...message,
                timestamp: Date.now(),
                from: message.from || 'system'
            });
            this.emit('message_received', { toAgentId, message });
        }
    }

    // 广播消息给所有Agent
    broadcastMessage(message, excludeAgentId = null) {
        for (const [agentId, queue] of this.messageQueue) {
            if (agentId !== excludeAgentId) {
                queue.push({
                    ...message,
                    timestamp: Date.now(),
                    from: message.from || 'system'
                });
            }
        }
        this.emit('message_broadcast', { message, excludeAgentId });
    }

    // 获取指定Agent的消息
    getMessages(agentId) {
        if (this.messageQueue.has(agentId)) {
            const messages = this.messageQueue.get(agentId);
            this.messageQueue.set(agentId, []); // 清空消息队列
            return messages;
        }
        return [];
    }

    // 实体管理
    registerEntity(entity) {
        const entityId = entity.eid || `ent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const entityWithId = { ...entity, eid: entityId };
        this.globalEntities.set(entityId, entityWithId);
        this.emit('entity_created', { entity: entityWithId });
        return entityId;
    }

    getEntity(entityId) {
        return this.globalEntities.get(entityId);
    }

    updateEntity(entityId, updates) {
        if (this.globalEntities.has(entityId)) {
            const existing = this.globalEntities.get(entityId);
            const updated = { ...existing, ...updates };
            this.globalEntities.set(entityId, updated);
            this.emit('entity_updated', { entityId, previous: existing, current: updated });
            return true;
        }
        return false;
    }

    // 获取所有实体
    getAllEntities() {
        return Array.from(this.globalEntities.values());
    }

    // 按位置获取实体
    getEntitiesByLocation(location) {
        const allEntities = this.getAllEntities();
        return allEntities.filter(entity => entity.location === location);
    }

    // 按类型获取实体
    getEntitiesByType(type) {
        const allEntities = this.getAllEntities();
        return allEntities.filter(entity => entity.data && entity.data.type === type);
    }

    // 事件系统
    on(eventType, callback) {
        if (!this.eventListeners.has(eventType)) {
            this.eventListeners.set(eventType, []);
        }
        this.eventListeners.get(eventType).push(callback);
    }

    off(eventType, callback) {
        if (this.eventListeners.has(eventType)) {
            const listeners = this.eventListeners.get(eventType);
            const index = listeners.indexOf(callback);
            if (index !== -1) {
                listeners.splice(index, 1);
            }
        }
    }

    emit(eventType, data) {
        if (this.eventListeners.has(eventType)) {
            this.eventListeners.get(eventType).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`事件处理错误 ${eventType}:`, error);
                }
            });
        }
    }

    // 世界事件循环
    startEventLoop() {
        const processWorldEvents = () => {
            if (!this.isRunning) return;

            // 处理状态改变触发
            this.processStateChangeTriggers();

            // 继续下一轮
            setTimeout(processWorldEvents, 100); // 每100ms检查一次
        };

        processWorldEvents();
    }

    processStateChangeTriggers() {
        // 这里可以添加基于世界状态变化的触发逻辑
        // 例如：当某个实体被创建时，触发相关Agent
    }

    // 获取世界状态快照
    getWorldState() {
        return {
            agentCount: this.agents.size,
            entityCount: this.globalEntities.size,
            activeAgents: Array.from(this.agents.keys()),
            recentActivity: this.getRecentActivity()
        };
    }

    getRecentActivity() {
        return {
            timestamp: Date.now(),
            summary: `世界中有 ${this.agents.size} 个活跃居民和 ${this.globalEntities.size} 个实体`
        };
    }

    // 关闭世界
    shutdown() {
        this.isRunning = false;
        this.emit('world_shutdown', {});
        console.log('共享世界已关闭');
    }
}

module.exports = { SharedWorld };
