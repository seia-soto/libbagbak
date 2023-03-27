#!/bin/sh

# >>-- bagbak
cd bagbak;
npm install;
npm run build;
cd ..;
# --<< bagbak

pnpm ts-node-esm scripts/useExternStrings.ts;
