const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const util = require('util');

// Promisify scrypt for async/await
const scrypt = util.promisify(crypto.scrypt);

const database = path.join(__dirname, '../data/pdmDb.json'); // adjust the path depending on your folder structure
const barcodeFolderDirectory = path.join(__dirname, '../data/barcodes');

// Run database checker function
let readProductsJson = initDatabase();

// Define function routes below //

// Check for an existing database file
function initDatabase() {
    const dataDir = path.dirname(database);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    if (!fs.existsSync(database)) {
        const emptyDb = { users: [], categories: [], products: [] };
        fs.writeFileSync(database, JSON.stringify(emptyDb, null, 2));
        return emptyDb;
    }

    try {
        const data = fs.readFileSync(database, "utf-8");
        const parsed = JSON.parse(data || '{}');
        return {
            users: Array.isArray(parsed.users) ? parsed.users : [],
            categories: Array.isArray(parsed.categories) ? parsed.categories : [],
            products: Array.isArray(parsed.products) ? parsed.products : []
        };
    } catch (err) {
        console.error("Error reading database, resetting:", err);
        const emptyDb = { users: [], categories: [], products: [] };
        fs.writeFileSync(database, JSON.stringify(emptyDb, null, 2));
        return emptyDb;
    }
}

// Hash a password function
async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex'); // unique salt
    const derivedKey = await scrypt(password, salt, 64); // 64-byte key
    return `${salt}:${derivedKey.toString('hex')}`; // store salt + hash
}

// Verify a password function
async function verifyPassword(password, storedHash) {
    const [salt, key] = storedHash.split(':');
    const derivedKey = await scrypt(password, salt, 64);
    return key === derivedKey.toString('hex');
}

// Request permission to access the database
async function getAccess(req, res) {

    const { username, password } = req.body;
    username = decodeURIComponent(username);

    try {

        // Check users data in json for user with requested username
        const user = readProductsJson.users.find(user => user.username === username);
        if (!user) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }

        // Verify password
        const passwordMatch = await verifyPassword(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ error: "Invalid username or password" });
        }

        res.status(200).json({ 
            message: "Login successful", 
            username: user.username,
            productSetIndex: user.productSetIndex 
        });

    } catch (err) {
        console.log(`We have the following error: ${err}`);
        return res.status(500).json({ message: `Server error: ${err.message}` });
    }

}

async function createNewUser(req, res) {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required" });
    }

    username = decodeURIComponent(username);

    try {
        // Initialize structure if DB file is empty/missing
        if (!readProductsJson || typeof readProductsJson !== "object") {
            readProductsJson = { users: [], categories: [], products: [] };
        }

        // Ensure all arrays exist
        readProductsJson.users = readProductsJson.users || [];
        readProductsJson.categories = readProductsJson.categories || [];
        readProductsJson.products = readProductsJson.products || [];

        // Check for existing username
        const existingUser = readProductsJson.users.find(u => u.username === username);
        if (existingUser) {
            return res.status(400).json({ error: "User already exists" });
        }

        const newUserIndex = readProductsJson.users.length;

        // Hash password
        const hashedPassword = await hashPassword(password);

        // Create user
        const newUser = {
            username,
            password: hashedPassword,
            productSetIndex: newUserIndex
        };

        // Push user and placeholders
        readProductsJson.users.push(newUser);
        readProductsJson.categories.push([]);
        readProductsJson.products.push([]);

        // Write safely to file
        const tmpFile = `${database}.tmp`;
        fs.writeFileSync(tmpFile, JSON.stringify(readProductsJson, null, 2));
        fs.renameSync(tmpFile, database);

        res.status(201).json({
            message: "User created successfully",
            user: { username: newUser.username, productSetIndex: newUser.productSetIndex }
        });

    } catch (err) {
        console.error("Error creating user:", err);
        res.status(500).json({ error: "Internal server error" });
    }
}

// Request entire database of products, sync product barcode images
async function getAllProducts(req, res) {

    // Ensure barcode folder exists
    if (!fs.existsSync(barcodeFolderDirectory)) {
        fs.mkdirSync(barcodeFolderDirectory, { recursive: true });
    }

    let username = decodeURIComponent(req.query.username);
    
    const user = readProductsJson.users.find(user => user.username === username);
    const userDataIndex = user.productSetIndex;

    try {

        if (!readProductsJson.products[userDataIndex]) {
            throw new Error("Products database not read properly");
        }

        // For each product check for existing barcode, else make api request
        const promises = readProductsJson.products[userDataIndex].map(async (product) => {
            const barcodeImagePath = path.join(barcodeFolderDirectory, `${product.id}.png`);
            const barcodeApiUrl = `https://barcodeapi.org/api/code128/`;

            try {
                await fs.promises.access(barcodeImagePath, fs.constants.F_OK);
            } catch (err) {
                const response = await fetch(`${barcodeApiUrl}${product.id}`);
                if (!response.ok) throw new Error('Barcode API response was bad');
                const imageBuffer = await response.arrayBuffer();
                await fs.promises.writeFile(barcodeImagePath, Buffer.from(imageBuffer));
            }
        });

        // Await all product checks, sort database, and send response
        await Promise.all(promises);
        readProductsJson.products[userDataIndex].sort((a, b) => b.fullPrice - a.fullPrice);
        res.status(200).json({
            "categories": readProductsJson.categories[userDataIndex],
            "products": readProductsJson.products[userDataIndex]
        });
        

    } catch (err) {
        console.error("Products database has not been read properly:", err);
        res.status(500).send("Internal server error");
    }
}

// Request for specific item from req.query
function getProductById (req, res) {

    let username = decodeURIComponent(req.query.username);
    let productID = decodeURIComponent(req.query.id);

    const user = readProductsJson.users.find(user => user.username === username);
    const userDataIndex = user.productSetIndex;

    var selectedItem = readProductsJson.products[userDataIndex].find(product => product.id == productID);
    if (selectedItem) {
        res.status(200).send(selectedItem);
    }
    else res.status(400).send("Item not found");
}

// Request for all products of specific category from req.query
function getProductsByCategory (req, res) {

    let username = decodeURIComponent(req.query.username);

    const user = readProductsJson.users.find(user => user.username === username);
    const userDataIndex = user.productSetIndex;

    var selectedProductsArray = readProductsJson.products[userDataIndex].filter((product) =>
        Array.isArray(product.category) &&
        product.category.some(
            (cat) => cat.toLowerCase() === searchCategory
        ));
    res.status(200).send(selectedProductsArray); 
}

// Request for random products given criteria in req.query
function getRandomProducts (req, res) {

    let username = decodeURIComponent(req.query.username);
    let categoryReq = decodeURIComponent(req.query.category)

    // Check for username in database and throw error if not found
    const user = readProductsJson.users.find(user => user.username === username);
    if (!user) {
        console.error(`User ${username} not found`);
        return res.status(404).json({error: 'User not found'});
    }

    try {

        // Set variables for requested parameters
        const userDataIndex = user.productSetIndex;
        const category = (categoryReq || '');
        const total = parseFloat(req.query.total);

        // API server print to console check for data
        console.log('--- /api/products.random called ---');
        console.log('Username: ', username);
        console.log('Total: ', total);
        console.log('Category: ', category);
        console.log('User Index: ', userDataIndex);

        function getRandomProductList (category, total) {

            function getSingleRandomProduct (category, total) {

                // Set needed variables
                let possibleProducts = {};
                let rollingSum = 0;

                // Get valid potential products based on passed category value
                const categoryFilteredProducts = (category === 'all') ?
                    readProductsJson.products[userDataIndex] :
                    readProductsJson.products[userDataIndex].filter(product =>
                        Array.isArray(product.category) && product.category.includes(category)
                    );

                // Sort products by price, high to low
                categoryFilteredProducts.sort((a, b) =>
                    parseFloat(b.fullPrice) - parseFloat(a.fullPrice)
                );

                // Build dictionary of {product: rollingSum} for any valid products
                for (const product of categoryFilteredProducts) {
                    let productFullPrice = parseFloat(product.fullPrice);
                    if (isNaN(productFullPrice)) continue;
                    if (productFullPrice <= total) {
                        rollingSum += productFullPrice;
                        possibleProducts[product.id] = rollingSum;
                    }
                    else break;
                }

                // Get a random number from the range of rollingSum
                const randomSum = Math.floor(Math.random() * rollingSum);

                // Find the product corresponding to the randomly selected sum
                for (const productId in possibleProducts) {
                    if (randomSum <= possibleProducts[productId]) {
                        let selectedProduct = categoryFilteredProducts.find(product =>
                            product.id === productId
                        );
                        return selectedProduct;
                    }
                }

                // A valid product was not found, perhaps total is less than any valid product price
                console.log(`No valid product was found in getSingleRandomProduct()\nrandomSum was ${randomSum}\ntotal was ${total}`);
                return null;

            } // End of getSingleRandomProduct() function

            // Set needed variables and product list
            let selectedProduct;
            let selectedProducts = [];
            let minimumRemainder = 0.98;
            let remainingTotal = total;

            // Fill list of products while tracking remaining total
            while (remainingTotal > minimumRemainder) {
                selectedProduct = getSingleRandomProduct(category, remainingTotal);
                if (!selectedProduct) break;
                selectedProducts.push(selectedProduct);
                remainingTotal -= parseFloat(selectedProduct.fullPrice);
            }

            // Return the list of products and the total price remainder
            return { selectedProducts, remainingTotal };

        }  // End of getRandomProductList() function

        // Make a first initial fetch of random products and report remainder value
        const firstResponseObject = getRandomProductList(category, total);

        // Reroll randomizer 4 times to minizmize the remainder
        for (let i = 0; (i < 4) && (firstResponseObject.remainingTotal > 0.15); i++) {

            // If initial product list has low enough remainder, skip reroll
            if (firstResponseObject.remainingTotal < 0.08) break;

            // Get another product list and compare, swap if needed
            else {
                let secondResponseObject = getRandomProductList(category, total);
                if (secondResponseObject.remainingTotal < firstResponseObject.remainingTotal) {
                    Object.assign(firstResponseObject, secondResponseObject);
                } 
            }

        } // End of for loop

        // Send api response
        if (firstResponseObject) res.status(200).json(firstResponseObject);

    } catch (error) {
        console.error('Server error in /api/products/random:', error);
        return res.status(500).json({ error: 'Internal Server Error'});
    }

}

// New item to add to database, received in req.body
async function createProduct(req, res) {

	// Collect the request data and validate
	let username = decodeURIComponent(req.query.username);
	const productID = decodeURIComponent(req.query.id);
	if (!username || !productID) return res.status(400).send("Not valid username or originalId input data:");

    // Check database for valid user and set respective data index
    const user = readProductsJson.users.find(user => user.username == username);
    if (!user) return res.status(404).send("User not found in database");
    const userDataIndex = user.productSetIndex;

    // Check database for existing product
    const newProductIndex = readProductsJson.products[userDataIndex].findIndex(product => product.id == productID);
    if (newProductIndex !== -1) return res.status(404).send('Product id already exists in database');

    // TEST
    console.log(`First test\nWe have the following data...`);
    console.log(`username=${username}\nproductID=${productID}\nuser=${user}`);

    // Construct product object explicitly
    const newProduct = {
        id: productID,
        name: req.body?.name || "",
        price: req.body?.price || "0.00",
        skuNum: req.body?.skuNum || productID,
        taxable: req.body?.taxable || "false",
        fullPrice: req.body?.fullPrice || parseFloat(req.body?.price || 0),
        category: Array.isArray(req.body.category)
            ? req.body.category.map(c => (typeof c === "string" ? c : c.category))
            : []
    };

    // Push and sort
    readProductsJson.products[userDataIndex].push(newProduct);
    readProductsJson.products[userDataIndex].sort((a, b) => b.fullPrice - a.fullPrice);

    // Request barcode from api
    const barcodeImagePath = path.join(barcodeFolderDirectory, `${req.body.id}.png`);
    const barcodeApiUrl = `https://barcodeapi.org/api/code128/`;

    // TEST
    console.log(`Second test\nWe have the following data...`);
    console.log(`barcodeImagePath=${barcodeImagePath}`);

    // Check to see if the file exists, otherwise generate new barcode image
    try {
    	await fs.promises.access(barcodeImagePath);
        console.log('Barcode image for this product already exists');
    } catch (err) {
        const response = await fetch(`${barcodeApiUrl}${req.body.id}`);
        if (!response.ok) throw new Error('Barcode API response was bad');
        const imageBuffer = await response.arrayBuffer();
        await fs.promises.writeFile(barcodeImagePath, Buffer.from(imageBuffer));
        console.log('New barcode image was generated');
    }

    // TEST
    console.log(`Third test\nA barcode file now exists...`);

    // Save updated database to file
    try {
        await fs.promises.writeFile(database, JSON.stringify(readProductsJson, null, 2));
    } catch (error) {
        console.error('Writing database update failed: ', error);
    }

    // TEST
    console.log(`Fourth test\nThe product data write was attempted`);

    // Send status message
    console.log('Sending success response');
    return res.status(200).send(`The following product has been added\n${JSON.stringify(req.body, null, 2)}`);
}

// Update existing item selected by req.query.id and data through req.body
async function updateProduct(req, res) {

    try{

        // Validate query data
        let username = decodeURIComponent(req.query.username);
        const originalId = req.query.id;
        if (!username || !originalId) {
            return res.status(400).send("Not valid username or original product id from input data:");
        }

        // TEST console logging
        console.log('The query data thus far has proven valid');

        // Check database for valid user and set respective data index
        const user = readProductsJson.users.find(user => user.username == username);
        if (!user) {
            return res.status(404).send("User not found in database");
        }
        const userDataIndex = user.productSetIndex;

        const productIndex = readProductsJson.products[userDataIndex].findIndex(p => p.id === originalId);
        if (productIndex === -1) return res.status(404).send("Product not found");

        const originalProduct = readProductsJson.products[userDataIndex][productIndex];

        const updatedProduct = {
            id: req.body?.skuNum || originalProduct.id,
            name: req.body?.name || originalProduct.name,
            price: req.body?.price || originalProduct.price,
            skuNum: req.body?.skuNum || originalProduct.skuNum,
            taxable: req.body?.taxable || originalProduct.taxable,
            fullPrice: req.body?.fullPrice || parseFloat(req.body?.price || originalProduct.price || 0),
            category: req.body?.category
                ? req.body.category.map(c => (typeof c === "string" ? c : c.category))
                : originalProduct.category
        };

        // Replace the product in the database and sort the list
        readProductsJson.products[userDataIndex][productIndex] = updatedProduct;
        readProductsJson.products[userDataIndex].sort((a, b) => b.fullPrice - a.fullPrice);

        // TEST console log
        console.log('All checks passed and new data has been inserted and sorted');

        // Handle barcode update if SKU changed
        if (updatedProduct.id !== originalProduct.id) {
            const oldBarcodePath = path.join(barcodeFolderDirectory, `${originalProduct.id}.png`);
            const newBarcodePath = path.join(barcodeFolderDirectory, `${updatedProduct.id}.png`);

            try { await fs.promises.unlink(oldBarcodePath); } catch {}
            const response = await fetch(`https://barcodeapi.org/api/code128/${updatedProduct.id}`);
            if (response.ok) {
                const buffer = Buffer.from(await response.arrayBuffer());
                await fs.promises.writeFile(newBarcodePath, buffer);
            }
        }

        // Write update data to database
        await fs.promises.writeFile(database, JSON.stringify(readProductsJson, null, 2));

        // Send status message
        console.log('Sending success response');
        res.status(200).send(`Product updated:\n${JSON.stringify(updatedProduct, null, 2)}`);

    } catch (error) {
        console.error('API crashed in updateProduct:', err);
        res.status(500).send('Server error while updating product');
    }

}

// Delete existing item and barcode selected by req.query
async function deleteProduct(req, res) {

	// Check for valid input data: username, productID
	let username = decodeURIComponent(req.query.username);
	const productID = req.query.id;
	if (!username || !productID) return res.status(400).send("Not valid username or originalId input data:");

    // Check database for valid user and set respective data index
    const user = readProductsJson.users.find(user => user.username == username);
    if (!user) return res.status(404).send("User not found in database");
    const userDataIndex = user.productSetIndex;

    // Check database for specified product
    const productIndex = readProductsJson.products[userDataIndex].findIndex(product => product.id == productID);
    if (productIndex === -1) return res.status(404).send('Product id not found in database');

    const oldBarcodeImagePath = path.join(barcodeFolderDirectory, `${productID}.png`);

    // Splice the specified product out of the database list
    readProductsJson.products[userDataIndex].splice(productIndex, 1);

    // Make all the async calls
    try {

        // Save updated database to file
        await fs.promises.writeFile(database, JSON.stringify(readProductsJson, null, 2));

        // Delete barcode image if file deleted successfully
        try {
            await fs.promises.access(oldBarcodeImagePath);
            await fs.promises.unlink(oldBarcodeImagePath);
            console.log('Old barcode image deleted successfully');
        } catch (error) {
            console.error('Failed to delete barcode image: ', error);
        }

        // Send status message
        res.status(200).send(`Product with id ${productID} deleted successfully`);

    } catch (error) {
        console.error('Writing database update failed: ', error);
        return res.status(500).send("Internal server error");
    }
}

// New category for database, received in red.query
async function createCategory(req, res) {

	// Check for valid input data: username, category
	let username = decodeURIComponent(req.query.username);
	const category = decodeURIComponent(req.query.category);
	if (!username || !category) return res.status(400).send(`Missing valid username [${username}] or category [${category}] data`);

	// Check if a user exists with given username
	const user = readProductsJson.users.find(user => user.username == username);
	if (!user) throw new Error(`User not found: ${username}`);

    // Get user index for referencing respective data
    const userDataIndex = user.productSetIndex;

    // Check database for preexisting category in database
    readProductsJson.categories[userDataIndex] = readProductsJson.categories[userDataIndex] || [];
    if (readProductsJson.categories[userDataIndex].includes(category)) {
        return res.status(409).send(`Category already exists: ${category}`);
    }

	try {

		// Push new category to database and sort
		readProductsJson.categories[userDataIndex].push(category);
		readProductsJson.categories[userDataIndex].sort();

		// Write updated data to file with atomic replace and send response
        const tmpFile = `${database}.tmp`;
        fs.writeFileSync(tmpFile, JSON.stringify(readProductsJson, null, 2));
        fs.renameSync(tmpFile, database);
        return res.status(200).send(`The following category has been added\n${JSON.stringify(category, null, 2)}`);

	} catch (err) {
		console.error(err);
		return res.status(401).send(`Error was thrown: ${err}`);
	}
}

// Update existing category, selected by req.query and req.body
async function updateCategory(req, res) {

	// Check for valid input data: username, category, newCategory
	let username = decodeURIComponent(req.query.username);
	const category = decodeURIComponent(req.query.category);
	const newCategory = decodeURIComponent(req.body.category);
	if (!username || !category || !newCategory) return res.status(400).send(`Missing valid username [${username}], category [${category}], or newCateogry [${newCategory}] data`);

	// Check if a user exists with given username
	const user = readProductsJson.users.find(user => user.username == username);
	if (!user) throw new Error(`User not found: ${username}`);

	// Get user index for referencing and get list of categories
	const userDataIndex = user.productSetIndex;
	const categoriesList = readProductsJson.categories[userDataIndex] || [];

    if (!categoriesList.includes(category)) return res.status(404).send(`Original category not found: ${category}`);
    if (categoriesList.includes(newCategory)) return res.status(409).send(`New category already exists: ${newCategory}`);

    // Update categories list
    const index = categoriesList.indexOf(category);

	try {

		// Replace the original category with new category
		categoriesList[index] = newCategory;

		// Update category in each product's category list
		for (const product of readProductsJson.products[userDataIndex]) {
			product.category = product.category.map(cat => cat == category ? newCategory : cat);
		}

		// Write updated data to file with atomic replace and send response
        const tmpFile = `${database}.tmp`;
        fs.writeFileSync(tmpFile, JSON.stringify(readProductsJson, null, 2));
        fs.renameSync(tmpFile, database);
		res.status(200).send(`Category rename from ${category} to ${newCategory}`);

	} catch (err) {
		console.error("Error updating category:", err);
		res.status(500).send("Internal server error");
	}
}

// Delete existing category from entire database, selected by red.query
async function deleteCategory(req, res) {

	// Check for valid input data: username, category, newCategory
	let username = decodeURIComponent(req.query.username);
	const category = decodeURIComponent(req.query.category);
	if (!username || !category) return res.status(400).send(`Missing valid username [${username}] or category [${category}]`);

	// Check if a user exists with given username
	const user = readProductsJson.users.find(user => user.username == username);
	if (!user) throw new Error(`User not found: ${username}`);

	// Get user index for referencing respective data
	const userDataIndex = user.productSetIndex;
    const categoriesList = readProductsJson.categories[userDataIndex] || [];

    const index = categoriesList.indexOf(category);
    if (index === -1) return res.status(404).send(`Category not found: ${category}`);

	try {

		// Delete category from database
		categoriesList.splice(index, 1);

		// Iterate through each product in database
		for (const product of readProductsJson.products[userDataIndex]) {
			// Splice the specified category out of each list of categories
			const spliceIndex = product.category.findIndex((category) => category == decodeURIComponent(req.query.category));
			if (spliceIndex != -1) product.category.splice(spliceIndex, 1);
		}

		// Write updated data to file with atomic replace and send response
        const tmpFile = `${database}.tmp`;
        fs.writeFileSync(tmpFile, JSON.stringify(readProductsJson, null, 2));
        fs.renameSync(tmpFile, database);
		res.status(200).send(`Category deleted successfully: ${category}`);

	} catch (err) {
		console.error("Error removing category:", err);
		return res.status(500).send("Internal server error");
	}
}

function sanityCheck(req, res) {
    res.status(200).send('pong');
}

module.exports = {
    getAccess,
    getAllProducts,
    getProductById,
    getProductsByCategory,
    getRandomProducts,
    createProduct,
    updateProduct,
    deleteProduct,
    createCategory,
    updateCategory,
    deleteCategory,
    sanityCheck,
    createNewUser
};