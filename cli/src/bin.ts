#!/usr/bin/env node
import { main } from './cli';

const code = main(process.argv.slice(2));
if (code >= 0) process.exit(code);
