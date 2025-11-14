#!/usr/bin/env node

/**
 * Export Strapi data from SQLite to a format that can be imported
 * This script exports all content from your local Strapi database
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '..', '.tmp', 'data.db');
const outputPath = path.join(__dirname, '..', 'strapi-data-export.json');

console.log('Starting Strapi data export...');
console.log(`Database path: ${dbPath}`);

if (!fs.existsSync(dbPath)) {
  console.error(`Error: Database file not found at ${dbPath}`);
  console.error('Make sure Strapi has been run at least once to create the database.');
  process.exit(1);
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
  console.log('Connected to SQLite database');
});

// Get all table names
db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'", (err, tables) => {
  if (err) {
    console.error('Error fetching tables:', err);
    db.close();
    process.exit(1);
  }

  console.log(`Found ${tables.length} tables to export`);
  
  const data = {};
  let completed = 0;
  const totalTables = tables.length;

  if (totalTables === 0) {
    console.log('No tables found. Database might be empty.');
    db.close();
    process.exit(0);
  }

  tables.forEach(({ name }) => {
    db.all(`SELECT * FROM ${name}`, (err, rows) => {
      if (err) {
        console.error(`Error exporting table ${name}:`, err.message);
      } else {
        data[name] = rows;
        console.log(`✓ Exported ${rows.length} rows from ${name}`);
      }
      
      completed++;
      if (completed === totalTables) {
        // Write to file
        fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
        console.log(`\n✓ Export complete!`);
        console.log(`Data saved to: ${outputPath}`);
        console.log(`Total tables exported: ${totalTables}`);
        
        // Calculate total rows
        const totalRows = Object.values(data).reduce((sum, rows) => sum + rows.length, 0);
        console.log(`Total rows exported: ${totalRows}`);
        
        db.close();
      }
    });
  });
});

