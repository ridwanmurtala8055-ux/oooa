import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { createJupiterApiClient } from '@jup-ag/api';

export class SolanaEngine {
  private connection: Connection;
  private jupiterApi: ReturnType<typeof createJupiterApiClient>;

  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl);
    this.jupiterApi = createJupiterApiClient();
  }

  async getQuote(inputMint: string, outputMint: string, amount: number, slippageBps: number) {
    return await this.jupiterApi.quoteGet({
      inputMint,
      outputMint,
      amount,
      slippageBps,
    });
  }

  async executeSwap(userKeypair: Keypair, quoteResponse: any) {
    const { swapTransaction } = await this.jupiterApi.swapPost({
      swapRequest: {
        quoteResponse,
        userPublicKey: userKeypair.publicKey.toString(),
        wrapAndUnwrapSol: true,
      },
    });
    // Transaction execution logic here
    return swapTransaction;
  }
}
