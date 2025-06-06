// keyvault.ts - Singleton module
import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

let secretClientInstance = null;

export function getSecretClient() {
    if (!secretClientInstance) {
        const credential = new DefaultAzureCredential();
        const keyVaultUrl = process.env["KEY_VAULT_URL"];

        if (!keyVaultUrl) {
            throw new Error("KEY_VAULT_URL environment variable not configured");
        }

        secretClientInstance = new SecretClient(keyVaultUrl, credential);
    }

    return secretClientInstance;
}
