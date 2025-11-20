#!/bin/bash
# Script to fix PostgreSQL database permissions for Strapi
# Usage: ./fix-database-permissions.sh [database_name] [username]

DB_NAME="${1:-strapi}"
DB_USER="${2:-strapi}"

echo "Fixing database permissions for database: $DB_NAME, user: $DB_USER"

# Check if psql is available
if ! command -v psql &> /dev/null; then
    echo "Error: psql command not found. Please install PostgreSQL client tools."
    exit 1
fi

# Execute the SQL script
psql -d "$DB_NAME" -U "$DB_USER" -f "$(dirname "$0")/fix-database-permissions.sql"

if [ $? -eq 0 ]; then
    echo "Database permissions fixed successfully!"
else
    echo "Error: Failed to fix database permissions. Please check the error messages above."
    echo ""
    echo "If you're using a different database user, you may need to run this as a superuser:"
    echo "  psql -d $DB_NAME -U postgres -f $(dirname "$0")/fix-database-permissions.sql"
    exit 1
fi


