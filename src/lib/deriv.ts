/**
 * Deriv API WebSocket Service
 */

export type DerivMessage = {
  msg_type: string;
  [key: string]: any;
};

export class DerivService {
  private socket: WebSocket | null = null;
  private appId: string;
  private token: string | null = null;
  private isDemo: boolean = true;
  private listeners: Map<string, Set<(data: any) => void>> = new Map();
  private onConnectCallback: (() => void) | null = null;
  private onDisconnectCallback: (() => void) | null = null;
  
  private endpoints = [
    "wss://ws.derivws.com/websockets/v3",
    "wss://ws.binaryws.com/websockets/v3"
  ];
  private currentEndpointIndex = 0;
  private isSwitchingEndpoints = false;
  private isIntentionallyDisconnected = false;

  private triedEndpointsCount = 0;

  constructor(appId: string = import.meta.env.VITE_DERIV_APP_ID || "1089") {
    this.appId = appId;
    const savedIndex = localStorage.getItem("deriv_endpoint_index");
    if (savedIndex !== null) {
      this.currentEndpointIndex = parseInt(savedIndex, 10);
      console.log(`[DerivService] Initializing with saved endpoint: ${this.endpoints[this.currentEndpointIndex]}`);
    }
  }

  connect() {
    this.isIntentionallyDisconnected = false;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const endpoint = this.endpoints[this.currentEndpointIndex];
    console.log(`[DerivService] Attempting connection to: ${endpoint} (AppID: ${this.appId})`);
    
    this.socket = new WebSocket(`${endpoint}?app_id=${this.appId}`);

    this.socket.onopen = () => {
      console.log(`[DerivService] Successfully connected to ${endpoint}`);
      this.isSwitchingEndpoints = false;
      this.triedEndpointsCount = 0; // Reset count on successful physical connection
      
      // If no token is set, we save the endpoint as working for now (public data only)
      if (!this.token) {
        localStorage.setItem("deriv_endpoint_index", this.currentEndpointIndex.toString());
      }
      
      if (this.onConnectCallback) this.onConnectCallback();
      if (this.token) {
        console.log("[DerivService] Sending authorization token...");
        this.authorize(this.token);
      }
    };

    this.socket.onmessage = (event) => {
      const data = JSON.parse(event.data) as DerivMessage;
      const type = data.msg_type;
      
      console.log(`[DerivService] Received message: ${type}`, data.error ? data.error : "");

      // Handle authorization errors to trigger fallback if necessary
      if (type === "authorize") {
        if (data.error) {
          console.error("[DerivService] Authorization error:", data.error.message);
          
          this.triedEndpointsCount++;
          
          // If authorization fails, and we haven't tried all endpoints, try fallback
          if (!this.isSwitchingEndpoints && this.triedEndpointsCount < this.endpoints.length) {
            console.log(`[DerivService] Authorization failed on ${endpoint}. Attempting fallback (${this.triedEndpointsCount}/${this.endpoints.length})...`);
            this.socket?.close(); // This will trigger onclose and switchEndpoint
          } else {
            console.warn("[DerivService] All endpoints failed for this token or max retries reached.");
            this.triedEndpointsCount = 0; // Reset for potential manual retries
          }
        } else {
          console.log("[DerivService] Authorization successful");
          this.triedEndpointsCount = 0;
          // Save this endpoint as the working one
          localStorage.setItem("deriv_endpoint_index", this.currentEndpointIndex.toString());
        }
      }
      
      if (this.listeners.has(type)) {
        this.listeners.get(type)?.forEach(callback => callback(data));
      }
      
      if (this.listeners.has("*")) {
        this.listeners.get("*")?.forEach(callback => callback(data));
      }
    };

    this.socket.onerror = (error) => {
      console.error(`[DerivService] WebSocket error on ${endpoint}:`, error);
    };

    this.socket.onclose = (event) => {
      console.log(`[DerivService] Connection closed from ${endpoint} (Code: ${event.code})`);
      
      if (this.onDisconnectCallback) this.onDisconnectCallback();

      // If we are not explicitly disconnecting and not already switching, try to reconnect or switch endpoints
      if (!this.isIntentionallyDisconnected && !this.isSwitchingEndpoints) {
        this.switchEndpoint();
      }
    };
  }

  private switchEndpoint() {
    this.isSwitchingEndpoints = true;
    this.currentEndpointIndex = (this.currentEndpointIndex + 1) % this.endpoints.length;
    const nextEndpoint = this.endpoints[this.currentEndpointIndex];
    
    console.log(`[DerivService] Switching to fallback endpoint: ${nextEndpoint}`);
    
    // Attempt reconnection after a short delay
    setTimeout(() => {
      this.isSwitchingEndpoints = false;
      this.connect();
    }, 2000);
  }

  setToken(token: string, isDemo: boolean = true) {
    this.token = token;
    this.isDemo = isDemo;
    this.triedEndpointsCount = 0; // Reset trial count for new token
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.authorize(token);
    }
  }

  private authorize(token: string) {
    this.send({ authorize: token });
  }

  subscribeTicks(symbol: string) {
    this.send({ ticks: symbol, subscribe: 1 });
  }

  unsubscribeTicks(symbol: string) {
    this.send({ forget_all: "ticks" });
  }

  buy(proposalId: string, price: number) {
    this.send({
      buy: proposalId,
      price: price
    });
  }

  getPriceProposal(symbol: string, contractType: "CALL" | "PUT", amount: number, duration: number, durationUnit: string) {
    this.send({
      proposal: 1,
      amount: amount,
      basis: "stake",
      contract_type: contractType,
      currency: "USD",
      duration: duration,
      duration_unit: durationUnit,
      symbol: symbol
    });
  }

  subscribeProposalOpenContract() {
    this.send({ proposal_open_contract: 1, subscribe: 1 });
  }

  getStatement(limit: number = 10) {
    this.send({ statement: 1, limit, description: 1 });
  }

  send(data: any) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      const type = Object.keys(data)[0];
      console.log(`[DerivService] Sending message: ${type}`, data);
      this.socket.send(JSON.stringify(data));
    } else {
      console.warn("[DerivService] Cannot send message: Socket is not open", data);
    }
  }

  on(type: string, callback: (data: any) => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)?.add(callback);
    return () => this.listeners.get(type)?.delete(callback);
  }

  onConnect(callback: () => void) {
    this.onConnectCallback = callback;
  }

  onDisconnect(callback: () => void) {
    this.onDisconnectCallback = callback;
  }

  disconnect() {
    this.isIntentionallyDisconnected = true;
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}

export const derivService = new DerivService();
