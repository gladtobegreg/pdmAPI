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
    const userDataIndex = user.productSetIndex;

    try {

        if (!readProductsJson.products[userDataIndex]) {
            throw new Error("Products database not read properly");
        }

        // For each product check for existing barcode, else make api request
        const promises = readProductsJson.products[userDataIndex].map(async (product) => {
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

    const user = readProductsJson.users.find(user => user.username === req.query.username);
    const userDataIndex = user.productSetIndex;

    var selectedItem = readProductsJson.products[userDataIndex].find(product => product.id == req.query.id);
    if (selectedItem) {
        res.status(200).send(selectedItem);
    }
    else res.status(400).send("Item not found");
}

// Request for all products of specific category from req.query
function getProductsByCategory (req, res) {

    const user = readProductsJson.users.find(user => user.username === req.query.username);
    const userDataIndex = user.productSetIndex;

    var selectedProductsArray = readProductsJson.products[userDataIndex].filter((product) => product.category == req.query.category);
    res.status(200).send(selectedProductsArray); 
}

// Request for random products given criteria in req.query
function getRandomProducts (req, res) {

    // Check for username in database and throw error if not found
    const user = readProductsJson.users.find(user => user.username === req.query.username);
    if (!user) {
        console.error(`User ${req.query.username} not found`);
        return res.status(404).json({error: 'User not found'});
    }

    try {

        // Set variables for requested parameters
        const userDataIndex = user.productSetIndex;
        const category = req.query.category.toLowerCase();
        const total = parseFloat(req.query.total);

        // API server print to console check for data
        console.log('--- /api/products.random called ---');
        console.log('Username: ', req.query.username);
        console.log('Total: ', total);
        console.log('User Index: ', userDataIndex);

        function getRandomProductList (category, total) {

            function getSingleRandomProduct (category, total) {

                // Set needed variables
                let possibleProducts = {};
                let rollingSum = 0;

                // Get valid potential products based on passed category value
                const categoryFilteredProducts = (category == 'all') ?
                    readProductsJson.products[userDataIndex] :
                    readProductsJson.products[userDataIndex].filter(product =>
                        Array.isArray(product.category) && product.category.includes(category)
                    );

                // Sort products by price, high to low
                categoryFilteredProducts.sort((a, b) =>
                    parseFloat(a.fullPrice) - parseFloat(b.fullPrice)
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
 	const fetchedNewProduct = readProductsJson.products[userDataIndex].find(product => product.id == req.query.id);
 	if (fetchedNewProduct) return res.status(409).send(`Product with that name already exists: ${fetchedNewProduct}`);

	try {

	    // Push product to database and request barcode from api
	    readProductsJson.products[userDataIndex].push(req.body);
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
        readProductsJson.products[userDataIndex].sort((a, b) => parseFloat(b.fullPrice) - parseFloat(a.fullPrice));
        fs.writeFileSync(database, JSON.stringify(readProductsJson, null, 2));
        return res.status(200).send(`The following product has been added\n${JSON.stringify(req.body, null, 2)}`);

	} catch (err) {
		console.error("Failed to create new product:", err);
		return res.status(500).send(`Server error adding:\n${JSON.stringify(req.body, null, 2)}`);
	}
}

// Update existing item selected by req.query.id and data through req.body
async function updateProduct(req, res) {

    // Collect the request data and validate
    const username = req.query.username;
    const originalId = req.query.id;
    if (!username || !originalId) return res.status(400).send("Not valid username or originalId input data:");

    // Check database for valid user and set respective data index
    const user = readProductsJson.user.find(user => user.username == username);
    if (!user) return res.status(404).send("User not found in database");
    const userDataIndex = user.productSetIndex;

    // Find the index of the product to update
    const originalProductIndex = readProductsJson.products[userDataIndex].findIndex(product => product.id == originalId);
    if (originalProductIndex === -1) return res.status(404).send('Product id not found in database');

    // Prepare the updated data including potential new product id
    const originalProduct = readProductsJson.products[userDataIndex][originalProductIndex];
    let newId = originalId;
    if (req.body.skuNum && req.body.skuNum != originalId) {
        newId = req.body.skuNum;        
    }
    
    // Construct the new product object
    const updatedProduct = {
        id: newId,
        name: req.body.name || originalProduct.name,
        price: req.body.price || originalProduct.price,
        skuNum: req.body.skuNum || originalProduct.skuNum,
        taxable: req.body.taxable || originalProduct.taxable,
        fullPrice: req.body.fullPrice || originalProduct.fullPrice,
        category: req.body.category || originalProduct.category
    }

    // Replace the product in the database and sort the list
    readProductsJson.products[userDataIndex][originalProductIndex] = updatedProduct;
    readProductsJson.products[userDataIndex].sort((a, b) => b.fullPrice - a.fullPrice);

    // Make all the async calls
    try {

        // Check for barcode update tasks
        if (req.body.skuNum && req.body.skuNum != originalId) {
            const oldBarcodeImagePath = `${barcodeFolderDirectory}${originalId}.png`;
            const newBarcodeImagePath = `${barcodeFolderDirectory}${newId}.png`;
            const barcodeApiUrl = `https://barcodeapi.org/api/code128/`;
            
            // Delete old barcode image
            try {
                await fs.promises.access(oldBarcodeImagePath);
                await fs.promises.unlink(oldBarcodeImagePath);
                console.log('Old barcode image deleted successfully');
            } catch (error) {
                console.error('Failed to delete barcode image: ', error);
            }
            
            // Fetch new barcode image
            try {
                const response = await fetch(`${barcodeApiUrl}${newId}`);
                if (!response.ok) throw new Error('Barcode API response was bad');
                const imageBuffer = await response.arrayBuffer();
                await fs.promises.writeFile(newBarcodeImagePath, Buffer.from(imageBuffer));
            } catch (error) {
                console.error('Failed to fetch new barcode image: ', error);
            }
        }

        // Save updated database to file
        try {
            await fs.promises.writeFile(database, JSON.stringify(readProductsJson, null, 2));
        } catch (error) {
            console.error('Writing database update failed: ', error);
        }
        
        // Send status message
        console.log('Sending success response');
        res.status(200).send(`Updated the following...\n${JSON.stringify(originalProduct, null, 2)}\nto:\n${JSON.stringify(updatedProduct, null, 2)}`);
    
    } catch (error) {
        console.error('Failed to handle update and barcode function: ', error);
    }
}

// Delete existing item and barcode selected by req.query
async function deleteProduct(req, res) {

	// Check for valid input data: username, productID
	const username = req.query.username;
	const productID = req.query.id;
	if (!username || !productID) return res.status(400).send(`Missing valid input data. Username: ${username}, Product ID: ${productID}`);

	// Check if a user exists with given username
	const user = readProductsJson.users.find(user => user.username == username);
	if (!user) throw new Error(`User not found: ${req.query.username}`);

	// Get user index for referencing respective data
	const userDataIndex = user.productSetIndex;
    const userProductList = readProductsJson.products[userDataIndex];

	// Check database for non-existent product in database
	const fetchedProductIndex = userProductList.findIndex(product => product.id === productID);
	if (fetchedProductIndex === -1) return res.status(404).send(`Product with ID ${productID} not found.`);

    // Collect product from found product id
    const fetchedProduct = userProductList[fetchedProductIndex];

	try {

        // Remove product from database set and write new file
        userProductList.splice(fetchedProductIndex, 1);
        fs.writeFileSync(database, JSON.stringify(userProductList, null, 2));

        // Remove barcode image for respective product
        const oldBarcodeImagePath = `${barcodeFolderDirectory}${fetchedProduct.id}.png`;
        if (fs.existsSync(oldBarcodeImagePath)) {
            await fs.promises.unlink(oldBarcodeImagePath);
        }

        // Send status message
        res.status(200).send(`Product with id ${productID} deleted successfully`);

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