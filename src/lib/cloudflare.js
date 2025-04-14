import fetch from 'node-fetch';
import chalk from 'chalk'; // Import chalk for colored output

// Cloudflare API interaction logic will go here

export class Cloudflare {
    constructor(email, apiKey) {
        if (!email || !apiKey) {
            throw new Error('Cloudflare email and API key are required.');
        }
        this.email = email;
        this.apiKey = apiKey;
        this.headers = {
            'Content-Type': 'application/json',
            'X-Auth-Email': email,
            'X-Auth-Key': apiKey,
        };
        this.accountId = null; // Will be fetched during initialization
    }

    // Initialize the client by fetching the account ID
    async initialize() {
        try {
            this.accountId = await this._getAccountId();
            // console.log(chalk.blue('Cloudflare Account ID fetched successfully.')); // Keep initialization quiet unless debugging
            return this;
        } catch (error) {
            console.error(chalk.red(`Error initializing Cloudflare client: ${error.message}`));
            throw error; // Re-throw the error to stop execution if initialization fails
        }
    }

    // Private method to fetch the account ID
    async _getAccountId() {
        const url = 'https://api.cloudflare.com/client/v4/accounts';
        const response = await fetch(url, { headers: this.headers });

        if (!response.ok) {
            let errorText = 'Unknown error';
            try {
                // Try to get more specific error from Cloudflare response
                const errorData = await response.json();
                errorText = errorData?.errors?.[0]?.message || await response.text();
            } catch (e) {
                errorText = await response.text(); // Fallback to plain text
            }
            throw new Error(`Failed to fetch account information: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        if (!result.success || !result.result || result.result.length === 0) {
            // Attempt to get a more specific error message if available
            const errorMessage = result?.errors?.[0]?.message || 'No Cloudflare accounts found or API error.';
            throw new Error(errorMessage);
        }

        // Assuming the user wants to use the first account found
        return result.result[0].id;
    }

    // Get Zone ID for a given domain name
    async getZoneIdFromDomain(domain) {
        if (!this.accountId) {
            throw new Error("Cloudflare client not initialized. Call initialize() first.");
        }
        const url = `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(domain)}&account.id=${this.accountId}`;

        try {
            const response = await fetch(url, { headers: this.headers });

            if (response.ok) {
                const result = await response.json();
                if (result.success && result.result && result.result.length > 0) {
                    return result.result[0].id; // Return the ID of the first matching zone
                }
                return null; // Domain not found in this account
            }

            // Handle non-200 responses that aren't critical errors but mean not found
            if (response.status === 404) {
                return null;
            }

            // Throw for other non-ok statuses (authentication, permissions etc.)
            let errorText = 'Unknown error';
            try {
                const errorData = await response.json();
                errorText = errorData?.errors?.[0]?.message || await response.text();
            } catch (e) {
                errorText = await response.text(); // Fallback to plain text
            }
            throw new Error(`Failed to get zone ID for ${domain}: ${response.status} ${errorText}`);
        } catch (error) {
            // Catch fetch errors (network issues, etc.)
            throw new Error(`Network or fetch error while getting zone ID for ${domain}: ${error.message}`);
        }
    }

    // Add a domain to the Cloudflare account if it doesn't exist
    async addDomainToCloudflare(domain) {
        if (!this.accountId) {
            throw new Error("Cloudflare client not initialized. Call initialize() first.");
        }

        console.log(chalk.blue(`Checking Cloudflare status for ${domain}...`));
        let zoneId = null;
        try {
            zoneId = await this.getZoneIdFromDomain(domain);
        } catch (error) {
            console.error(chalk.red(`Error checking domain status for ${domain}: ${error.message}`));
            throw error; // Propagate error up
        }

        if (zoneId) {
            // Domain already exists, try to get details like nameserver status
            const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}`;
            let status = 'unknown';
            let nameservers = [];
            try {
                const response = await fetch(url, { headers: this.headers });
                if (!response.ok) {
                    // Try to get error message from response
                    let errorDetail = `Status: ${response.status}`;
                    try { errorDetail = (await response.json())?.errors?.[0]?.message || errorDetail; } catch (e) { /* ignore json parse error */ }
                    console.warn(chalk.yellow(`Could not fetch details for existing zone ${domain}. ${errorDetail}`));
                } else {
                    const result = (await response.json()).result;
                    status = result?.status || 'unknown';
                    nameservers = result?.name_servers || [];
                }
            } catch (error) {
                console.warn(chalk.yellow(`Warning: Error fetching details for existing zone ${domain}. ${error.message}`));
            }
            console.log(chalk.green(`✓ Domain ${domain} is already managed by Cloudflare (Zone ID: ${zoneId}, Status: ${status})`));

            if (status !== 'active' && nameservers.length > 0) {
                console.log(chalk.yellow(`
  Action Required: Domain status is '${status}'. Ensure nameservers are set at your registrar:`));
                nameservers.forEach(ns => console.log(chalk.yellow(`   • ${ns}`)));
            } else if (status !== 'active') {
                console.log(chalk.yellow(`
  Action Required: Domain status is '${status}'. Please verify configuration and nameservers.`));
            }
            return zoneId; // Return existing zone ID
        }

        // Domain doesn't exist, proceed to add it
        console.log(chalk.blue(`Domain ${domain} not found in this Cloudflare account. Adding...`));
        const addZoneUrl = 'https://api.cloudflare.com/client/v4/zones';
        const data = {
            name: domain,
            account: { id: this.accountId },
            jump_start: false, // Set to false to avoid automatic DNS record scanning
            type: 'full', // Use 'full' for standard setup
        };

        try {
            const response = await fetch(addZoneUrl, {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify(data),
            });

            const result = await response.json(); // Try to parse JSON regardless of status

            if (!response.ok || !result.success) {
                const errorMessage = result?.errors?.[0]?.message || `Status ${response.status} - ${response.statusText}`;
                // Provide specific feedback for common issues
                if (errorMessage.includes('already exists')) { // More robust check
                    throw new Error(`Failed to add domain: ${domain} already exists in another Cloudflare account or configuration.`);
                } else if (response.status === 403) { // Permission issues
                    throw new Error(`Failed to add domain: Permission denied. Check API key permissions (Zone:Edit).`);
                }
                throw new Error(`Failed to add domain ${domain} to Cloudflare: ${errorMessage}`);
            }

            if (!result.result?.id) {
                throw new Error(`Failed to add domain ${domain}: Invalid API response structure ${JSON.stringify(result)}`);
            }

            const newZoneId = result.result.id;
            const nameservers = result.result.name_servers || [];

            console.log(chalk.green(`✓ Domain ${domain} added to Cloudflare (Zone ID: ${newZoneId})`));
            if (nameservers.length > 0) {
                console.log(chalk.yellow('\nAction Required: Configure these nameservers at your domain registrar:'));
                for (const ns of nameservers) {
                    console.log(chalk.yellow(`   • ${ns}`));
                }
                console.log(chalk.yellow('\nWait for nameservers to update before the domain is fully active.'));
            } else {
                console.log(chalk.yellow('\nCould not retrieve nameservers. Please check your Cloudflare dashboard.'));
            }

            return newZoneId; // Return the newly created zone ID

        } catch (error) {
            // Catch errors during the add process (API errors, fetch errors)
            console.error(chalk.red(`❌ Critical Error adding domain ${domain}: ${error.message}`));
            throw error; // Re-throw the error as adding the domain is fundamental
        }
    }
}
