#!/usr/bin/env node

import { Command } from 'commander';
import dotenv from 'dotenv';
import chalk from 'chalk';
import { DomainManager } from './lib/domain-manager.js';
import inquirer from 'inquirer';
import ora from 'ora';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

// Load environment variables from .env file
dotenv.config();

// Helper to get directory name in ES module
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Function to read package.json for version info
async function getPackageVersion() {
    try {
        const packageJsonPath = path.join(__dirname, '..', 'package.json');
        const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
        const packageJson = JSON.parse(packageJsonContent);
        return packageJson.version || 'unknown';
    } catch (error) {
        console.warn(chalk.yellow('Could not read package.json for version.'));
        return 'unknown';
    }
}

const program = new Command();

// --- Main Program Setup ---
async function main() {
    const version = await getPackageVersion();

    program
        .name('domainflare')
        .description('Configure domains with Cloudflare for domain sales landing pages')
        .version(version);

    // --- Credential Handling ---
    async function getCredentials() {
        // Prioritize .env variables
        const credentials = {
            email: process.env.CLOUDFLARE_EMAIL,
            apiKey: process.env.CLOUDFLARE_API_KEY,
            // Add other credentials as needed (e.g., destinationEmail)
            // destinationEmail: process.env.DESTINATION_EMAIL,
        };

        const questions = [];

        // Email and API Key are mandatory for adding domains
        if (!credentials.email) {
            questions.push({
                type: 'input',
                name: 'email',
                message: 'Enter your Cloudflare email:',
                validate: input => input && input.includes('@') ? true : 'Valid email is required'
            });
        }

        if (!credentials.apiKey) {
            questions.push({
                type: 'password',
                name: 'apiKey',
                message: 'Enter your Cloudflare API key:',
                mask: '*',
                validate: input => input && input.length > 0 ? true : 'API key is required'
            });
        }

        // Add prompts for other required info (like destinationEmail) here if needed later

        if (questions.length > 0) {
            console.log(chalk.yellow('\nSome required configuration was not found (check .env file). Please provide it:'));
            const answers = await inquirer.prompt(questions);
            // Merge answers, giving prompted values precedence only if .env was missing
            return { ...credentials, ...answers };
        }

        // If no questions asked, all mandatory credentials were in process.env
        return credentials;
    }

    // --- Commands ---

    // 'park' command
    program
        .command('park')
        .description('Configure a single domain (adds to Cloudflare if needed)')
        .argument('<domain>', 'Domain name to configure')
        // .option('-f, --file <filepath>', 'Path to a file containing domains (one per line)') // Add later
        .action(async (domain, options) => {
            // Basic domain validation (can be improved)
            if (!domain || !domain.includes('.')) {
                console.error(chalk.red('Error: Please provide a valid domain name.'));
                process.exit(1);
            }
            // TODO: Add validation for file option when implemented
            // if (domain && options.file) { ... }
            // if (!domain && !options.file) { ... }

            const spinner = ora('Starting configuration...').start();
            try {
                // 1. Get Credentials
                spinner.text = 'Checking credentials...';
                const credentials = await getCredentials();
                spinner.succeed('Credentials checked.');

                // 2. Initialize Domain Manager
                spinner.start('Initializing Cloudflare connection...');
                const manager = new DomainManager(
                    credentials.email,
                    credentials.apiKey
                    // Pass other credentials like destinationEmail here when needed
                );
                await manager.init();
                spinner.succeed('Cloudflare connection initialized.');

                // 3. Configure the Domain (currently just adds it)
                spinner.start(`Processing domain: ${domain}...`);
                const success = await manager.configureDomain(domain);
                // configureDomain handles its own logging for success/failure steps

                if (success) {
                    spinner.succeed(chalk.green(`Domain ${domain} processed.`));
                } else {
                    // Error messages are logged within configureDomain or addDomainToCloudflare
                    spinner.fail(chalk.red(`Failed to process domain ${domain}. See logs above for details.`));
                    process.exit(1); // Exit with error code if configuration failed
                }

            } catch (error) {
                // Catch errors from getCredentials, init, or configureDomain
                spinner.fail(chalk.red(`An unexpected error occurred: ${error.message}`));
                // Log stack trace for debugging if needed
                // console.error(error.stack);
                process.exit(1);
            }
        });

    // 'config' command (placeholder)
    program
        .command('config')
        .description('Save configuration to .env file (Not yet implemented)')
        .action(() => {
            console.log(chalk.yellow('The config command is not yet implemented.'));
            // TODO: Implement inquirer prompts to save to .env
        });

    // --- Parse Arguments ---
    program.parse(process.argv);

    // Show help if no command was provided
    if (!process.argv.slice(2).length) {
        program.help();
    }
}

// Run the main async function
main().catch(error => {
    // Catch any unhandled errors from the main setup
    console.error(chalk.red(`\nFATAL ERROR: ${error.message}`));
    process.exit(1);
});
