#!/usr/bin/env node
import { main } from './cli';

process.exit(main(process.argv.slice(2)));
