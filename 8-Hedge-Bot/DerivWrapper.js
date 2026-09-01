import WebSocket from 'ws';

export class DerivWrapper {
    constructor(appId, token) {
        this.appId = appId;
        this.token = token;
        this.ws = null;
        this.balance = 0;
        this.activeContracts = new Map();
        this.authorized = false;
        this.onTick = null; // Callback
    }

    async connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${this.appId}`);

            this.ws.onopen = async () => {
                console.log('Connected to Deriv WS');
                try {
                    await this.authorize();
                    resolve();
                } catch (e) {
                    reject(e);
                }
            };

            this.ws.onmessage = (msg) => this.handleMessage(msg);
            this.ws.onerror = (err) => {
                console.error('Deriv WS Error:', err);
                reject(err);
            };
        });
    }

    async authorize() {
        return this.send({ authorize: this.token }).then(res => {
            if (res.error) throw new Error(res.error.message);
            this.balance = res.authorize.balance;
            this.authorized = true;
            console.log('Authorized. Balance:', this.balance);
            return res;
        });
    }

    async subscribeTicks(symbol) {
        this.symbol = symbol;
        this.send({ ticks: symbol });
    }

    async buy(contractType, stake, duration, durationUnit, prediction) {
        const params = {
            buy: 1,
            price: stake,
            parameters: {
                amount: stake,
                basis: 'stake',
                contract_type: contractType,
                currency: 'USD',
                duration: duration,
                duration_unit: durationUnit,
                symbol: this.symbol // Use stored symbol
            }
        };

        if (prediction !== null && prediction !== undefined) {
            params.parameters.barrier = prediction.toString();
        }

        return this.send(params).then(res => {
            if (res.error) throw new Error(res.error.message);
            return res.buy; // contains contract_id
        });
    }

    async checkContract(contractId) {
        // In real API, we usually subscribe to proposals or portfolio.
        // For simplicity, we can use 'proposal_open_contract'
        return this.send({ proposal_open_contract: 1, contract_id: contractId }).then(res => {
            if (res.error) return null;
            const contract = res.proposal_open_contract;

            // Map to format expected by UnifiedBot
            return {
                is_sold: contract.is_sold,
                profit: contract.profit,
                status: contract.status
            };
        });
    }

    handleMessage(msg) {
        const data = JSON.parse(msg.data);
        if (data.msg_type === 'tick') {
            if (this.onTick) this.onTick(data.tick);
        }
        // Handle pending promises if we implemented a request/response map
        // For simplicity, we'll assume sequential or use a simple id mapper if needed.
        // BUT 'send' below needs to handle correlation.
        if (data.req_id && this.pendingReqs.has(data.req_id)) {
            const { resolve, reject } = this.pendingReqs.get(data.req_id);
            this.pendingReqs.delete(data.req_id);
            if (data.error) resolve(data); // Let caller handle error field
            else resolve(data);
        }
    }

    pendingReqs = new Map();
    reqIdCounter = 1;

    send(data) {
        return new Promise((resolve, reject) => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                return reject(new Error('WS not connected'));
            }
            const reqId = this.reqIdCounter++;
            data.req_id = reqId;
            this.pendingReqs.set(reqId, { resolve, reject });
            this.ws.send(JSON.stringify(data));
        });
    }

    disconnect() {
        if (this.ws) this.ws.close();
    }
}
