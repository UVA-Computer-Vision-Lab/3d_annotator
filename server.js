const express = require('express');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const cors = require('cors');
const os = require('os');

const app = express();
const PORT = 3000;

// Cache for sorted folder lists (still useful for navigation)
let sortedFoldersCache = {
    name: null,
    objectCount: null,
    timestamp: null
};

// Enable CORS for all routes with specific configuration
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'DELETE', 'PUT', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware to parse JSON requests
app.use(express.json({ limit: '10mb' }));

// Serve static files from public directory
app.use(express.static('public'));

// Helper function to process a single folder's metadata using async I/O
const processFolderMetadataAsync = async (itemPath, item, basePath, level) => {
    const relativePath = path.join(basePath, item);

    let has3dBoxRefined = false;
    let refinedBoxPath = null;
    let isDeleted = false;
    let annotator = null;
    let annotationDuration = null;
    let objectCount = 0;

    // Use async readdir
    const files = await fsPromises.readdir(itemPath);

    // Check refined file
    const refinedFile = files.find(file => file.endsWith('3dbox_refined.json'));
    has3dBoxRefined = refinedFile !== undefined;
    if (has3dBoxRefined) {
        refinedBoxPath = 'assets/val' + path.join(relativePath, refinedFile).replace(/\\/g, '/');
    }

    // Count objects from ground truth file
    const groundTruthFile = files.find(file => file === '3dbbox.json');
    if (groundTruthFile) {
        const groundTruthPath = path.join(itemPath, groundTruthFile);
        const groundTruthData = await fsPromises.readFile(groundTruthPath, 'utf8').catch(() => null);
        if (groundTruthData) {
            const parsed = JSON.parse(groundTruthData);
            if (Array.isArray(parsed)) {
                objectCount = parsed.length;
            }
        }
    }

    // Check if deleted
    const deletedFile = files.find(file => file === 'deleted.json');
    isDeleted = deletedFile !== undefined;

    // Read annotator from deleted.json if exists
    if (isDeleted && deletedFile) {
        const deletedPath = path.join(itemPath, deletedFile);
        const deletedData = await fsPromises.readFile(deletedPath, 'utf8').catch(() => null);
        if (deletedData) {
            const parsed = JSON.parse(deletedData);
            if (parsed.annotator && !annotator) {
                annotator = parsed.annotator;
            }
        }
    }

    // Check for annotation metadata
    const metaFile = files.find(file => file === 'annotation_meta.json');
    if (metaFile) {
        const metaPath = path.join(itemPath, metaFile);
        const metaData = await fsPromises.readFile(metaPath, 'utf8').catch(() => null);
        if (metaData) {
            const parsed = JSON.parse(metaData);
            if (!annotator) {
                annotator = parsed.annotator;
            }
            annotationDuration = parsed.durationSeconds;
        }
    }

    return {
        name: item,
        path: 'assets/val/' + relativePath.replace(/\\/g, '/'),
        isFolder: true,
        level: level,
        has3dBoxRefined: has3dBoxRefined,
        refinedBoxPath: refinedBoxPath,
        is_deleted: isDeleted,
        annotator: annotator,
        annotationDuration: annotationDuration,
        objectCount: objectCount,
        isExpanded: false
    };
};

// Helper function to build sorted folder cache
const buildSortedFoldersCache = (assetsDir) => {
    const items = fs.readdirSync(assetsDir).filter(item => {
        const itemPath = path.join(assetsDir, item);
        return fs.statSync(itemPath).isDirectory();
    });

    // Sort by name
    const sortedByName = [...items].sort((a, b) => a.localeCompare(b));

    // Sort by object count
    const sortedByObjectCount = [...items].sort((a, b) => {
        const pathA = path.join(assetsDir, a);
        const pathB = path.join(assetsDir, b);

        let countA = 0;
        let countB = 0;

        const filesA = fs.readdirSync(pathA);
        const groundTruthA = filesA.find(file => file === '3dbbox.json');
        if (groundTruthA) {
            const dataA = JSON.parse(fs.readFileSync(path.join(pathA, groundTruthA), 'utf8'));
            countA = Array.isArray(dataA) ? dataA.length : 0;
        }

        const filesB = fs.readdirSync(pathB);
        const groundTruthB = filesB.find(file => file === '3dbbox.json');
        if (groundTruthB) {
            const dataB = JSON.parse(fs.readFileSync(path.join(pathB, groundTruthB), 'utf8'));
            countB = Array.isArray(dataB) ? dataB.length : 0;
        }

        return countA - countB; // Ascending order
    });

    // Update cache
    sortedFoldersCache = {
        name: sortedByName,
        objectCount: sortedByObjectCount,
        timestamp: Date.now()
    };

    return sortedFoldersCache;
};

// Helper function to get sorted folders (with cache)
const getSortedFolders = (assetsDir, sortBy = 'name') => {
    // If cache doesn't exist, build it
    if (!sortedFoldersCache.name || !sortedFoldersCache.objectCount) {
        buildSortedFoldersCache(assetsDir);
    }

    return sortBy === 'objectCount' ? sortedFoldersCache.objectCount : sortedFoldersCache.name;
};

// Root endpoint
app.get('/', (req, res) => {
    res.status(200);
    res.send("Welcome to root URL of Server");
});

// GET endpoint to retrieve directory structure
// GET endpoint to retrieve directory structure with pagination
app.get('/api/directory', async (req, res) => {
    try {
        // Extract pagination parameters
        const page = parseInt(req.query.page) || 1;
        const itemsPerPage = 400;
        const forceRefresh = req.query.forceRefresh === 'true';

        const assetsDir = path.join(__dirname, 'public', 'assets', 'val');

        // Create directory if it doesn't exist
        if (!fs.existsSync(assetsDir)) {
            fs.mkdirSync(assetsDir, { recursive: true });
        }

        const startTime = Date.now();

        // Get all items in directory
        const items = fs.readdirSync(assetsDir);
        const folders = items.filter(item => {
            const itemPath = path.join(assetsDir, item);
            return fs.statSync(itemPath).isDirectory();
        });

        // Sort folders alphabetically
        folders.sort((a, b) => a.localeCompare(b));

        // Determine optimal concurrency based on CPU cores
        // Use 2x CPU cores for I/O bound operations (since we're not CPU-bound)
        const cpuCount = os.cpus().length;
        const CONCURRENCY_LIMIT = cpuCount * 2;

        // Process folders with controlled concurrency
        const structure = [];

        // Process in batches with concurrency control
        for (let i = 0; i < folders.length; i += CONCURRENCY_LIMIT) {
            const batch = folders.slice(i, i + CONCURRENCY_LIMIT);
            const batchPromises = batch.map(async item => {
                const itemPath = path.join(assetsDir, item);
                const folderData = await processFolderMetadataAsync(itemPath, item, '', 0);
                return folderData;
            });

            const batchResults = await Promise.all(batchPromises);
            structure.push(...batchResults.filter(item => item !== null));

        }

        // Add index as id to each item
        structure.forEach((item, index) => {
            item.id = index + 1;
        });

        // Build cache for sorted folders (this will be used by other endpoints)
        if (forceRefresh || !sortedFoldersCache.name || !sortedFoldersCache.objectCount) {
            buildSortedFoldersCache(assetsDir);
        }

        // Only count parent directories (top-level) for pagination
        const parentDirectories = structure.filter(item => item.isFolder);
        const totalItems = parentDirectories.length;
        const totalPages = Math.ceil(totalItems / itemsPerPage);

        // Sort parent directories alphabetically
        parentDirectories.sort((a, b) => a.name.localeCompare(b.name));

        // If pagination is requested, prepare data for the specific page
        // For the API, we'll return the full structure but with pagination info
        // The actual pagination will be handled on the client side

        res.status(200).json({
            success: true,
            structure: structure,
            pagination: {
                currentPage: page,
                itemsPerPage: itemsPerPage,
                totalItems: totalItems,
                totalPages: totalPages
            }
        });
    } catch (error) {
        console.error('Error reading directory structure:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to read directory structure',
            details: error.message
        });
    }
});



app.get('/api/getindex/:id', (req, res) => {
    try {
        // Extract parameters
        const { id } = req.params;
        const sortBy = req.query.sortBy || 'name';
        const itemsPerPage = 400;

        const assetsDir = path.join(__dirname, 'public', 'assets', 'val');

        // Create directory if it doesn't exist
        if (!fs.existsSync(assetsDir)) {
            fs.mkdirSync(assetsDir, { recursive: true });
        }

        // Use cached sorted folders instead of re-reading and re-sorting
        const items = getSortedFolders(assetsDir, sortBy);

        // Find the item with matching id
        const itemIndex = items.findIndex(item => item === id || item.startsWith(id));

        // Calculate the correct page number based on the found item's index
        let page = 1;
        if (itemIndex !== -1) {
            page = Math.floor(itemIndex / itemsPerPage) + 1;
        } else {
            // If no item found, use the query parameter if provided
            page = parseInt(req.query.page) || 1;
        }

        // Prepare response object
        const response = {
            success: true,
            currentPage: page
        };

        // Add previous and next indices if the item was found
        if (itemIndex !== -1) {
            response.item = {
                current: items[itemIndex],
                currentIndex: itemIndex,
                previous: itemIndex > 0 ? items[itemIndex - 1] : null,
                previousIndex: itemIndex > 0 ? itemIndex - 1 : null,
                next: itemIndex < items.length - 1 ? items[itemIndex + 1] : null,
                nextIndex: itemIndex < items.length - 1 ? itemIndex + 1 : null
            };
        }

        res.status(200).json(response);
    } catch (error) {
        console.error('Error reading directory:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to read directory structure',
            details: error.message
        });
    }
});

// GET endpoint to find next unlabeled sample
app.get('/api/getnextunlabeled/:id', (req, res) => {
    try {
        const { id } = req.params;
        const sortBy = req.query.sortBy || 'name';
        const assetsDir = path.join(__dirname, 'public', 'assets', 'val');

        if (!fs.existsSync(assetsDir)) {
            return res.status(404).json({
                success: false,
                error: 'Assets directory not found'
            });
        }

        // Use cached sorted folders instead of re-reading and re-sorting
        const items = getSortedFolders(assetsDir, sortBy);

        // Find current item index
        const currentIndex = items.findIndex(item => item === id);

        if (currentIndex === -1) {
            return res.status(404).json({
                success: false,
                error: 'Current item not found',
                receivedId: id,
                availableItems: items.length
            });
        }

        // Search for next unlabeled sample
        for (let i = currentIndex + 1; i < items.length; i++) {
            const itemPath = path.join(assetsDir, items[i]);
            const itemStats = fs.statSync(itemPath);

            if (itemStats.isDirectory()) {
                const files = fs.readdirSync(itemPath);

                // Check if this folder is labeled or deleted
                const hasAnnotation = files.some(file => file === 'annotation_meta.json' || file === '3dbox_refined.json');
                const isDeleted = files.some(file => file === 'deleted.json');

                // If not labeled and not deleted, this is the next unlabeled sample
                if (!hasAnnotation && !isDeleted) {
                    return res.status(200).json({
                        success: true,
                        nextUnlabeled: items[i],
                        nextIndex: i
                    });
                }
            }
        }

        // No unlabeled sample found after current
        res.status(200).json({
            success: true,
            nextUnlabeled: null,
            message: 'No more unlabeled samples found'
        });

    } catch (error) {
        console.error('Error finding next unlabeled sample:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to find next unlabeled sample',
            details: error.message
        });
    }
});

// New API endpoint for folder statistics
app.get('/api/directory-stats', (req, res) => {
    try {
        const assetsDir = path.join(__dirname, 'public', 'assets', 'val');

        // Create directory if it doesn't exist
        if (!fs.existsSync(assetsDir)) {
            fs.mkdirSync(assetsDir, { recursive: true });
            return res.status(200).json({
                success: true,
                stats: {
                    totalFolders: 0,
                    refinedFolders: 0,
                    deletedFolders: 0
                }
            });
        }

        // Function to count folders by type recursively
        const countFolders = (dir) => {
            let stats = {
                totalFolders: 0,
                refinedFolders: 0,
                deletedFolders: 0,
                annotatorStats: {},
                annotatorAnnotations: {},  // Count annotations separately
                annotatorDeletions: {}     // Count deletions separately
            };

            const items = fs.readdirSync(dir);

            items.forEach(item => {
                const itemPath = path.join(dir, item);
                const itemStats = fs.statSync(itemPath);

                if (itemStats.isDirectory()) {
                    stats.totalFolders++;

                    // Check if this folder has refinements or is deleted
                    const files = fs.readdirSync(itemPath);

                    if (files.some(file => file.endsWith('3dbox_refined.json'))) {
                        stats.refinedFolders++;
                    }

                    if (files.some(file => file === 'deleted.json')) {
                        stats.deletedFolders++;
                    }
                    
                    // Check for annotator info from multiple sources
                    let annotatorName = null;
                    let isAnnotation = false;
                    let isDeletion = false;

                    // Check annotation_meta.json (new format with timing)
                    const metaFile = files.find(file => file === 'annotation_meta.json');
                    if (metaFile) {
                        try {
                            const metaPath = path.join(itemPath, metaFile);
                            const metaData = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                            annotatorName = metaData.annotator;
                            isAnnotation = true;
                        } catch (err) {
                            console.error('Error reading annotation_meta.json:', err);
                        }
                    }

                    // Check deleted.json (for opted out images)
                    const deletedFile = files.find(file => file === 'deleted.json');
                    if (deletedFile) {
                        try {
                            const deletedPath = path.join(itemPath, deletedFile);
                            const deletedData = JSON.parse(fs.readFileSync(deletedPath, 'utf8'));
                            if (deletedData.annotator) {
                                // If no annotator from annotation, use deletion annotator
                                if (!annotatorName) {
                                    annotatorName = deletedData.annotator;
                                }
                                isDeletion = true;
                                // Track deletion separately
                                const deletionAnnotator = deletedData.annotator;
                                stats.annotatorDeletions[deletionAnnotator] = (stats.annotatorDeletions[deletionAnnotator] || 0) + 1;
                            }
                        } catch (err) {
                            console.error('Error reading deleted.json:', err);
                        }
                    }

                    // Check old annotator_info.json (backward compatibility)
                    if (!annotatorName) {
                        const annotatorFile = files.find(file => file === 'annotator_info.json');
                        if (annotatorFile) {
                            try {
                                const annotatorPath = path.join(itemPath, annotatorFile);
                                const annotatorData = JSON.parse(fs.readFileSync(annotatorPath, 'utf8'));
                                annotatorName = annotatorData.annotator;
                                isAnnotation = true;
                            } catch (err) {
                                console.error('Error reading annotator_info.json:', err);
                            }
                        }
                    }

                    // Add to stats
                    if (annotatorName) {
                        // Total count
                        stats.annotatorStats[annotatorName] = (stats.annotatorStats[annotatorName] || 0) + 1;

                        // Annotation count (only if has annotation_meta.json or annotator_info.json)
                        if (isAnnotation) {
                            stats.annotatorAnnotations[annotatorName] = (stats.annotatorAnnotations[annotatorName] || 0) + 1;
                        }
                    }

                    // Recursively count in subfolders
                    const subStats = countFolders(itemPath);
                    stats.totalFolders += subStats.totalFolders;
                    stats.refinedFolders += subStats.refinedFolders;
                    stats.deletedFolders += subStats.deletedFolders;

                    // Merge annotator stats
                    Object.keys(subStats.annotatorStats).forEach(annotator => {
                        stats.annotatorStats[annotator] = (stats.annotatorStats[annotator] || 0) + subStats.annotatorStats[annotator];
                    });

                    // Merge annotation stats
                    Object.keys(subStats.annotatorAnnotations).forEach(annotator => {
                        stats.annotatorAnnotations[annotator] = (stats.annotatorAnnotations[annotator] || 0) + subStats.annotatorAnnotations[annotator];
                    });

                    // Merge deletion stats
                    Object.keys(subStats.annotatorDeletions).forEach(annotator => {
                        stats.annotatorDeletions[annotator] = (stats.annotatorDeletions[annotator] || 0) + subStats.annotatorDeletions[annotator];
                    });
                }
            });

            return stats;
        };

        // Get the stats
        const stats = countFolders(assetsDir);

        res.status(200).json({
            success: true,
            stats: stats
        });
    } catch (error) {
        console.error('Error getting directory statistics:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get directory statistics',
            details: error.message
        });
    }
});

// POST endpoint to save JSON data
app.post('/api/save/:id', (req, res) => {
    try {
        const { id } = req.params;
        const jsonData = req.body;

        // Validate inputs
        if (!id) {
            return res.status(400).json({ error: 'ID parameter is required' });
        }

        if (!jsonData || Object.keys(jsonData).length === 0) {
            return res.status(400).json({ error: 'No JSON data provided' });
        }

        // Define save directory
        const saveDirectory = path.join(__dirname, 'public', 'assets', 'val', id);

        // Create directory structure if it doesn't exist
        if (!fs.existsSync(saveDirectory)) {
            fs.mkdirSync(saveDirectory, { recursive: true });
        }

        // Create filename and path
        const filename = `3dbox_refined.json`;
        const filePath = path.join(saveDirectory, filename);

        // Write the file
        fs.writeFileSync(filePath, JSON.stringify(jsonData, null, 2));

        res.status(200).json({
            success: true,
            message: 'File saved successfully',
            path: `/assets/val/${id}/${filename}`
        });
    } catch (error) {
        console.error('Error saving file:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to save file',
            details: error.message
        });
    }
});


app.post('/api/save/:id/deleted', (req, res) => {
    try {
        const { id } = req.params;
        const jsonData = req.body;

        // Validate inputs
        if (!id) {
            return res.status(400).json({ error: 'ID parameter is required' });
        }

        if (!jsonData || Object.keys(jsonData).length === 0) {
            return res.status(400).json({ error: 'No JSON data provided' });
        }

        // Define save directory
        const saveDirectory = path.join(__dirname, 'public', 'assets', 'val', id);

        // Create directory structure if it doesn't exist
        if (!fs.existsSync(saveDirectory)) {
            fs.mkdirSync(saveDirectory, { recursive: true });
        }

        // Delete existing annotation files if they exist
        const filesToDelete = ['3dbox_refined.json', 'annotation_meta.json', 'annotator_info.json'];
        const deletedFiles = [];

        filesToDelete.forEach(file => {
            const fileToDelete = path.join(saveDirectory, file);
            if (fs.existsSync(fileToDelete)) {
                fs.unlinkSync(fileToDelete);
                deletedFiles.push(file);
            }
        });

        // Create filename and path for deleted.json
        const filename = `deleted.json`;
        const filePath = path.join(saveDirectory, filename);

        // Write the deleted.json file
        fs.writeFileSync(filePath, JSON.stringify(jsonData, null, 2));

        res.status(200).json({
            success: true,
            message: 'Image marked for deletion',
            path: `/assets/val/${id}/${filename}`,
            deletedFiles: deletedFiles
        });
    } catch (error) {
        console.error('Error saving deletion marker:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to mark for deletion',
            details: error.message
        });
    }
});

// DELETE endpoint to remove deleted.json marker
app.delete('/api/save/:id/deleted', (req, res) => {
    try {
        const { id } = req.params;

        // Validate inputs
        if (!id) {
            return res.status(400).json({ error: 'ID parameter is required' });
        }

        // Define file path
        const saveDirectory = path.join(__dirname, 'public', 'assets', 'val', id);
        const filePath = path.join(saveDirectory, 'deleted.json');

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                success: false,
                error: 'Deletion marker not found'
            });
        }

        // Delete the file
        fs.unlinkSync(filePath);

        res.status(200).json({
            success: true,
            message: 'Deletion marker removed successfully'
        });
    } catch (error) {
        console.error('Error removing deletion marker:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to remove deletion marker',
            details: error.message
        });
    }
});

// POST endpoint to save annotation metadata (annotator info + timing)
app.post('/api/save/:id/annotation_meta', (req, res) => {
    try {
        const { id } = req.params;
        const jsonData = req.body;

        // Validate inputs
        if (!id) {
            return res.status(400).json({ error: 'ID parameter is required' });
        }

        if (!jsonData || !jsonData.annotator) {
            return res.status(400).json({ error: 'Annotator name is required' });
        }

        // Define save directory
        const saveDirectory = path.join(__dirname, 'public', 'assets', 'val', id);

        // Create directory structure if it doesn't exist
        if (!fs.existsSync(saveDirectory)) {
            fs.mkdirSync(saveDirectory, { recursive: true });
        }

        // Create filename and path
        const filename = `annotation_meta.json`;
        const filePath = path.join(saveDirectory, filename);

        // Write the file
        fs.writeFileSync(filePath, JSON.stringify(jsonData, null, 2));

        res.status(200).json({
            success: true,
            message: 'Annotation metadata saved successfully',
            path: `/assets/val/${id}/${filename}`
        });
    } catch (error) {
        console.error('Error saving annotation metadata:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to save annotation metadata',
            details: error.message
        });
    }
});

// Start the server
app.listen(PORT, (error) => {
    if (!error) {
        console.log("Server is Successfully Running, and App is listening on port " + PORT);
        console.log("JSON files will be saved to: /public/assets/{id}/ directory");
    } else {
        console.log("Error occurred, server can't start", error);
    }
});