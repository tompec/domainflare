import { Cloudflare } from './cloudflare.js';
import chalk from 'chalk';

// Domain configuration logic will go here

export class DomainManager {
    constructor(email, apiKey) {
        this.email = email;
        this.apiKey = apiKey;
        this.cloudflare = new Cloudflare(email, apiKey); // Instantiate Cloudflare client
    }

    // Initialize the manager by initializing the Cloudflare client
    async init() {
        await this.cloudflare.initialize();
        console.log(chalk.blue('Domain Manager initialized.'));
        return this;
    }

    // Configure a single domain
    async configureDomain(domain) {
        try {
            console.log(chalk.cyan(`\nStarting configuration for ${domain}...`));

            // Step 1: Ensure the domain is in the Cloudflare account
            const zoneId = await this.cloudflare.addDomainToCloudflare(domain);

            // TODO: Add subsequent configuration steps here (DNS, Worker, Email, etc.)
            if (zoneId) {
                console.log(chalk.green(`\n✅ Basic configuration check/add for ${domain} completed.`));
                // For now, just return true if the domain was added/found
                return true;
            } else {
                // This case should ideally not happen if addDomainToCloudflare throws on critical errors
                console.error(chalk.red(`Failed to obtain Zone ID for ${domain}. Configuration halted.`));
                return false;
            }

        } catch (error) {
            // Catch errors specifically from the configuration process for this domain
            console.error(chalk.red(`\n❌ Error configuring domain ${domain}: ${error.message}`));
            // Log stack trace for debugging if needed
            // console.error(error.stack);
            return false; // Indicate failure for this domain
        }
    }

    // Placeholder for bulk processing - can be implemented later
    async processBulkDomains(domainsFile) {
        console.log(chalk.yellow(`Bulk processing from ${domainsFile} is not yet implemented.`));
        // TODO: Implement reading file and calling configureDomain for each line
    }
}
