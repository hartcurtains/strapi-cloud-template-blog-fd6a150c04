/**
 * Utility functions for matching uploaded images to products based on filename patterns
 * For Strapi admin plugin
 */

/**
 * Extract the last 2 characters before the file extension as the color ID
 * Example: "ACALIA_Blue_42.jpg" -> "42"
 */
export function extractColorId(filename) {
    // Remove file extension
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');

    // Get last 2 characters
    const colorId = nameWithoutExt.slice(-2);

    return colorId;
}

/**
 * Normalize a product name for matching by removing special characters,
 * converting to lowercase, and removing extra whitespace
 */
export function normalizeProductName(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '') // Remove all non-alphanumeric characters
        .trim();
}

/**
 * Parse a filename into its components: product name and color ID
 * Example: "ACALIA_Blue_42.jpg" -> { productName: "ACALIA", colorId: "42" }
 */
export function parseColorIdFromFilename(filename) {
    const colorId = extractColorId(filename);

    // Remove file extension
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');

    // Remove the color ID (last 2 chars) and any trailing underscores/hyphens
    const productPart = nameWithoutExt.slice(0, -2).replace(/[-_]+$/, '');

    // Extract the product name (first part before underscore or hyphen)
    const productName = productPart.split(/[-_]/)[0];

    return {
        productName,
        colorId,
        originalFilename: filename
    };
}

/**
 * Calculate Levenshtein distance between two strings
 * (minimum number of single-character edits needed to change one string into the other)
 */
function levenshteinDistance(str1, str2) {
    const matrix = [];

    // Initialize matrix
    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }

    // Fill in the rest of the matrix
    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
    }

    return matrix[str2.length][str1.length];
}

/**
 * Match an image filename to products using partial string matching
 * Returns matches sorted by confidence (highest first)
 */
export function matchImageToProduct(imageName, products) {
    const parsed = parseColorIdFromFilename(imageName);
    const normalizedImageName = normalizeProductName(parsed.productName);

    const matches = [];

    for (const product of products) {
        const normalizedProductName = normalizeProductName(product.name);

        // Calculate confidence based on string similarity
        let confidence = 0;

        // Exact match (after normalization)
        if (normalizedImageName === normalizedProductName) {
            confidence = 100;
        }
        // Product name starts with image name
        else if (normalizedProductName.startsWith(normalizedImageName)) {
            confidence = 90;
        }
        // Image name starts with product name
        else if (normalizedImageName.startsWith(normalizedProductName)) {
            confidence = 85;
        }
        // Product name contains image name
        else if (normalizedProductName.includes(normalizedImageName)) {
            confidence = 70;
        }
        // Image name contains product name
        else if (normalizedImageName.includes(normalizedProductName)) {
            confidence = 65;
        }
        // Calculate Levenshtein distance for fuzzy matching
        else {
            const distance = levenshteinDistance(normalizedImageName, normalizedProductName);
            const maxLength = Math.max(normalizedImageName.length, normalizedProductName.length);
            const similarity = 1 - distance / maxLength;

            // Only consider matches with at least 60% similarity
            if (similarity >= 0.6) {
                confidence = Math.round(similarity * 60); // Scale to 0-60 range
            }
        }

        // Only include matches with confidence >= 50
        if (confidence >= 50) {
            matches.push({
                productId: product.id,
                productName: product.name,
                confidence,
                colorId: parsed.colorId
            });
        }
    }

    // Sort by confidence (highest first)
    return matches.sort((a, b) => b.confidence - a.confidence);
}

export default {
    extractColorId,
    normalizeProductName,
    parseColorIdFromFilename,
    matchImageToProduct
};
