const fs = require('fs');
const database = './pdmDb.json';
const barcodeFolderDirectory = './barcodes/';
let readData = fs.readFileSync(database); 
let readProductsJson = JSON.parse(readData);

// Define function routes below //

// Request permission to access the database
function getAccess(req, res) {

    const { username, password } = req.body;

    try {

        // Check users data in json for user with requested username
        const user = readProductsJson.users.find(user => user.username === username);

        // Invalid username, user not found
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Invalid password
        if (user.password !== password) {
            // Password does not match
            return res.status(401).json({ message: 'Invalid password' });
        }

        // Successful login
        return res.status(200).json({ message: 'Login successful', username: user.username });

    } catch (err) {
        console.log(`We have the following error: ${err}`);
        return res.status(500).json({ message: `Server error: ${err.message}` });
    }

    const user = readProductsJson.users.find(user => user.username === username);
    return res.status(200).json({ message: 'Login successful', username: user.username });
}

// Request entire database of products, sync product barcode images
async function getAllProducts(req, res) {
    
    const user = readProductsJson.users.find(user => user.username === req.query.username);
    const userProductIndex = user.productSetIndex;

    try {

        if (!readProductsJson.products[userProductIndex]) {
            throw new Error("Products database not read properly");
        }

        // For each product check for existing barcode, else make api request
        const promises = readProductsJson.products[userProductIndex].map(async (product) => {
            const barcodeImagePath = `${barcodeFolderDirectory}${product.id}.png`;
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
        readProductsJson.products[userProductIndex].sort((a, b) => b.fullPrice - a.fullPrice);
        // res.status(200).send(readProductsJson.products[userProductIndex]);
        res.status(200).json({
            "categories": readProductsJson.categories[userProductIndex],
            "products": readProductsJson.products[userProductIndex]
        });
        

    } catch (err) {
        console.error("Products database has not been read properly:", err);
        res.status(500).send("Internal server error");
    }
}

// Request for specific item from req.query
function getProductById (req, res) {

    const user = readProductsJson.users.find(user => user.username === req.query.username);
    const userProductIndex = user.productSetIndex;

    var selectedItem = readProductsJson.products[userProductIndex].find(product => product.id == req.query.id);
    if (selectedItem) {
        res.status(200).send(selectedItem);
    }
    else res.status(400).send("Item not found");
}

// Request for all products of specific category from req.query
function getProductsByCategory (req, res) {

    const user = readProductsJson.users.find(user => user.username === req.query.username);
    const userProductIndex = user.productSetIndex;

    var selectedProductsArray = readProductsJson.products[userProductIndex].filter((product) => product.category == req.query.category);
    res.status(200).send(selectedProductsArray); 
}

// Request for random products given criteria in req.query
function getRandomProducts (req, res) {

    const user = readProductsJson.users.find(user => user.username === req.query.username);
    const userProductIndex = user.productSetIndex;

    // Pull request parameters
    var category = req.query.category;
    var total = req.query.total; // Consider parseFloat() to get decimal places from total

    function getSingleRandomProduct(category, total) {

        //let selectedProduct;
        let possibleProducts = {};
        let rollingSum = 0;

        const categoryFilteredProducts =
            (category == 'all') ?
            readProductsJson.products[userProductIndex] :
            readProductsJson.products[userProductIndex].filter(product => product.category == category);

        // Sort the json items by price, high to low
        categoryFilteredProducts.sort((a, b) => a.fullPrice - b.fullPrice);

        // Iterate through product list and build dictionary of product:rollingSum for any valid products
        for (const product of categoryFilteredProducts) {
            let productFullPrice = parseFloat(product.fullPrice);
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
                
                let selectedProduct = categoryFilteredProducts.find(product => product.id == productId);
                return selectedProduct;
            }
        }

        // No valid product is found, usually total is smaller than any product price
        console.log(`No valid product was found in getSingleRandomProduct()\nrandomSum was ${randomSum}\ntotal was ${total}`);
        return null;

    } // End of getSingleRandomProduct() function

    function getRandomProductList(category, total) {

        // Set variables and product list
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

        // Return the list of products and the total price remainder for the list        
        return { selectedProducts, remainingTotal };

    } // End of getRandomProductList() function

    // Make a first initial fetch of random products and report remainder value
    const firstResponseObject = getRandomProductList(category, total);

    // Reroll randomizer 4 times to minizmize the remainder
    for (let i = 0; (i < 4) && (firstResponseObject.remainingTotal > 0.15); i++) {

        // If initial product list has low enough remainder, skip reroll
        if (firstResponseObject.remainingTotal < 0.08) break;

        else {
            let secondResponseObject = getRandomProductList(category, total);
            if (secondResponseObject.remainingTotal < firstResponseObject.remainingTotal) {
                // Better remainder rolled, replace original object
                Object.assign(firstResponseObject, secondResponseObject);
            } 
        }

    } // End of for loop

    // Report remainder in server console
    console.log(`Final remainder: ${firstResponseObject.remainingTotal}\n`);
    if (firstResponseObject.remainingTotal < 0.009)
        console.log(`The remaining total was very little\nHere is the firstResponseObject.selectedProducts:
            \n${JSON.stringify(firstResponseObject.selectedProducts, null, 2)}`);
    //console.log(`Reported products: ${JSON.stringify(firstResponseObject.selectedProducts, null, 2)}`);

    // Send response to api call
    if (firstResponseObject) res.status(200).send(firstResponseObject);

}

// New item to add to database, received in req.body
async function createProduct(req, res) {

	// Check for valid input data: username, productID
	const username = req.query.username;
	const productID = req.query.id;
	if (!username || !productID) return res.status(400).send(`Missing valid username [${req.query.username}] or product ID [${req.query.id}]`);

	// Check if a user exists with given username
	const user = readProductsJson.users.find(user => user.username == username);
	if (!user) throw new Error(`User not found: ${req.query.username}`);

	// Get user index for referencing respective data
	const userDataIndex = user.productSetIndex;

	// Check if new product already exists, if so, throw error
 	let fetchedNewProduct = readProductsJson.products[userDataIndex].find(product => product.id == req.query.id);
 	if (fetchedNewProduct) return res.status(409).send(`Product with that name already exists: ${fetchedNewProduct}`);

	try {

	    // Push product to database and request barcode from api
	    readProductsJson.products[userProductIndex].push(req.body);
	    const barcodeImagePath = `${barcodeFolderDirectory}${req.body.id}.png`;
	    const barcodeApiUrl = `https://barcodeapi.org/api/code128/`;

	    // Fetch barcode from api, buffer barcode, and save
	    try {
	    	await fs.promises.access(barcodeImagePath, fs.constants.F_OK);
	    } catch (err) {
            const response = await fetch(`${barcodeApiUrl}${req.body.id}`);
            if (!response.ok) throw new Error('Barcode API response was bad');
            const imageBuffer = await response.arrayBuffer();
            await fs.promises.writeFile(barcodeImagePath, Buffer.from(imageBuffer));
	    }

	    // Sort products, submit to database, and send response
        readProductsJson.products[userProductIndex].sort((a, b) => b.fullPrice - a.fullPrice);
        fs.writeFileSync(database, JSON.stringify(readProductsJson, null, 2));
        return res.status(200).send(`The following product has been added\n${JSON.stringify(req.body, null, 2)}`);

	} catch (err) {
		console.error("Failed to create new product:", err);
		return res.status(500).send(`Server error adding:\n${JSON.stringify(req.body, null, 2)}`);
	}
}

// Update existing item selected by req.query.id and data through req.body
async function updateProduct(req, res) {

	// Check for valid input data: username, productID, newSkuNum
	const username = req.query.username;
	const productID = req.query.id;
	const newSkuNum = req.query.skuNum;
	if (!username || !productID || !newSkuNum) return res.status(400).send(`Missing valid username [${req.query.username}], product ID [${req.query.id}], or sku number[${req.query.skuNum}]`);

	// Check if a user exists with given username
	const user = readProductsJson.users.find(user => user.username == username);
	if (!user) throw new Error(`User not found: ${username}`);

	// Get user index for referencing respective data
	const userDataIndex = user.productSetIndex;

	// Check if new product already exists, if so, throw error
 	let fetchedNewProduct = readProductsJson.products[userDataIndex].find(product => product.id == req.query.id);
 	if (fetchedNewProduct) return res.status(409).send(`Product with that name already exists: ${fetchedNewProduct}`);

 	// Check if original product exists, otherwise throw error
 	let originalProductIndex = readProductsJson.products[userDataIndex].findIndex(product => product.id == req.query.id);
 	if (originalProductIndex == -1) return res.status(404).send(`Product with that ID does not exist: ${req.query.id}`);

 	// Get orignal product
 	let fetchedOriginalProduct = readProductsJson.products[userDataIndex][originalProductIndex];

	// Define new product using given data if applicable
	const updatedProduct = {
	    "id": req.body.skuNum ? req.body.skuNum : fetchedOriginalProduct.id,
	    "name": req.body.name ? req.body.name : fetchedOriginalProduct.name,
	    "price": req.body.price ? req.body.price : fetchedOriginalProduct.price,
	    "skuNum": req.body.skuNum ? req.body.skuNum : fetchedOriginalProduct.skuNum,
	    "taxable": (req.body.taxable != fetchedOriginalProduct.taxable)? req.body.taxable : fetchedOriginalProduct.taxable,
	    "fullPrice": req.body.fullPrice ? req.body.fullPrice : fetchedOriginalProduct.fullPrice,
	    "category": req.body.category ? req.body.category : fetchedOriginalProduct.category
	}

 	try {

 		// Update product in database, sort list of products
 		readProductsJson.products[userDataIndex][originalProductIndex] = updatedProduct;
 		readProductsJson.products[userDataIndex].sort((a, b) => b.fullPrice - a.fullPrice);
 		fs.writeFileSync(database, JSON.stringify(readProductsJson, null, 2));

 		// Update barcode image if SKU was updated, query being new id and fetchedOriginalProduct being the old id
 		if (req.query.skuNum && req.query.skuNum != fetchedOriginalProduct.id) {

            const oldBarcodeImagePath = `${barcodeFolderDirectory}${fetchedProduct.id}.png`;
            const newBarcodeImagePath = `${barcodeFolderDirectory}${req.body.id}.png`;
            const barcodeApiUrl = `https://barcodeapi.org/api/code128/`;

            // Delete existing barcode image file
            if (fs.existsSync(oldBarcodeImagePath)) {
                await fs.promises.unlink(oldBarcodeImagePath);
            }

            // Fetch new barcode image
            const response = await fetch(`${barcodeApiUrl}${req.body.id}`);
            if (!response.ok) throw new Error('Barcode API response was bad');
            const imageBuffer = await response.arrayBuffer();
            await fs.promises.writeFile(newBarcodeImagePath, Buffer.from(imageBuffer));

 		}

        // Send status message
        res.status(200).send(`Updated the following...\n${JSON.stringify(fetchedOriginalProduct, null, 2)}\nto...\n${JSON.stringify(updatedProduct, null, 2)}`);

	} catch (err) {
		console.error("Failed to update product", err);
		res.status(500).send("Internal server error");
	}
}

// Delete existing item and barcode selected by req.query
async function deleteProduct(req, res) {

	// Check for valid input data: username, productID
	const username = req.query.username;
	const productID = req.query.id;
	if (!username || !category) return res.status(400).send(`Missing valid input data. Username: ${username}, Product ID: ${productID}`);

	// Check if a user exists with given username
	const user = readProductsJson.users.find(user => user.username == username);
	if (!user) throw new Error(`User not found: ${req.query.username}`);

	// Get user index for referencing respective data
	const userDataIndex = user.productSetIndex;

	// Check database for non-existent product id in database
	let fetchedProduct = readProductsJson.products[userDataIndex].find(product => product.id == req.query.id);
	if (!fetchedProduct) return res.status(409).send(`Product with that id not found. Given id: ${JSON.stringify(fetchedProduct, null, 2)}`);

	try {

        // Remove product from database set and write new file
        readProductsJson.products[userSetIndex].splice(fetchedProductIndex, 1);
        fs.writeFileSync(database, JSON.stringify(readProductsJson, null, 2));

        // Remove barcode image for respective product
        const oldBarcodeImagePath = `${barcodeFolderDirectory}${readProductsJson.products[userSetIndex][fetchedProductIndex].id}.png`;
        if (fs.existsSync(oldBarcodeImagePath)) {
            await fs.promises.unlink(oldBarcodeImagePath);
        }

        // Send status message
        res.status(200).send(`Product with id ${req.query.id} deleted successfully`);

	} catch (err) {
		console.error("Error removing product or deleting barcode image:", err);
		return res.status(500).send("Internal server error");
	}
}

// New category for database, received in red.query
async function createCategory(req, res) {

	// Check for valid input data: username, category
	const username = req.query.username;
	const category = req.query.category;
	if (!username || !category) return res.status(400).send(`Missing valid username [${req.query.username}] or category [${req.query.category}] data`);

	// Check if a user exists with given username
	const user = readProductsJson.users.find(user => user.username == username);
	if (!user) throw new Error(`User not found: ${req.query.username}`);

	// Get user index for referencing respective data
	const userDataIndex = user.productSetIndex;

	// Check database for preexisting category in database
	let fetchedCategory = readProductsJson.categories[userDataIndex].find(category => category == req.query.category);
	if (fetchedCategory) return res.status(409).send(`Category with that name already exists: ${category}`);

	try {

		// Push new category to database and sort
		readProductsJson.categories[userDataIndex].push(category);
		readProductsJson.categories[userDataIndex].sort();

		// Submit to database, and send response
		fs.writeFileSync(database, JSON.stringify(readProductsJson, null, 2));
		return res.status(200).send(`The following category has been added\n${JSON.stringify(req.query.category, null, 2)}`);

	} catch (err) {
		console.error(err);
		return res.status(401).send(`Error was thrown: ${err}`);
	}
}

// Update existing category, selected by req.query and req.body
async function updateCategory(req, res) {

	// Check for valid input data: username, category, newCategory
	const username = req.query.username;
	const category = req.query.category;
	const newCategory = req.body.category;
	if (!username || !category || !newCategory) return res.status(400).send(`Missing valid username [${req.query.username}], category [${req.query.category}], or newCateogry [${newCategory}] data`);

	// Check if a user exists with given username
	const user = readProductsJson.users.find(user => user.username == username);
	if (!user) throw new Error(`User not found: ${req.query.username}`);

	// Get user index for referencing and get list of categories
	const userDataIndex = user.productSetIndex;
	const categoriesList = readProductsJson.categories[userDataIndex];

	// Check if new category already exists, if so, throw error
	const fetchedNewCategory = categoriesList.find(category => category == req.body.category);
	if (fetchedNewCategory) return res.status(409).send(`Category with that name already exists: ${fetchedNewCategory}`);

	// Check if original category exists, otherwise throw error
	const originalCategoryIndex = categoriesList.findIndex(category => category == req.query.category);
	if (originalCategoryIndex == -1) return res.status(404).send(`Category with that name does not exist: ${req.query.category}`);

	try {

		// Replace the original category with new category
		categoriesList[originalCategoryIndex] = newCategory;

		// Update category in each product's category list
		for (const product of readProductsJson.products[userDataIndex]) {
			product.category = product.category.map(cat => cat == category ? newCategory : cat);
		}

		// Save data changes to database file
		fs.writeFileSync(database, JSON.stringify(readProductsJson, null, 2));

		// Send response
		res.status(200).send(`Category rename from ${category} to ${newCategory}`);

	} catch (err) {
		console.error("Error updating category:", err);
		res.status(500).send("Internal server error");
	}
}

// Delete existing category from entire database, selected by red.query
async function deleteCategory(req, res) {

	// Check for valid input data: username, category, newCategory
	const username = req.query.username;
	const category = req.query.category;
	if (!username || !category) return res.status(400).send(`Missing valid username [${req.query.username}], category [${req.query.category}], or newCateogry [${newCategory}] data`);

	// Check if a user exists with given username
	const user = readProductsJson.users.find(user => user.username == username);
	if (!user) throw new Error(`User not found: ${req.query.username}`);

	// Get user index for referencing respective data
	const userDataIndex = user.productSetIndex;

	// Check database for missing category in database
	const fetchedCategory = readProductsJson.categories[userDataIndex].find(category => category == req.query.category);
	if (!fetchedCategory) return res.status(404).send(`Category with that name does not exist: ${category}`);

	// Collect index for category
	const fetchedCategoryIndex = readProductsJson.categories[userDataIndex].findIndex((category) => category == req.query.category);

	try {

		// Delete category from database
		readProductsJson.categories[userDataIndex].splice(fetchedCategoryIndex, 1);

		// Iterate through each product in database
		for (const product of readProductsJson.products[userDataIndex]) {

			// Splice the specified category out of each list of categories
			const spliceIndex = product.category.findIndex((category) => category == req.query.category);
			if (spliceIndex != -1) product.category.splice(spliceIndex, 1);

		}

		// Write data back to file
		fs.writeFileSync(database, JSON.stringify(readProductsJson, null, 2));

		// Send response
		res.status(200).send(`Category deleted successfully: ${fetchedCategory}`);

	} catch (err) {
		console.error("Error removing category:", err);
		return res.status(500).send("Internal server error");
	}
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
    deleteCategory
};