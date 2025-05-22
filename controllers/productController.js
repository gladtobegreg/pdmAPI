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
            "products": readProductsJson.products[userProductIndex],
            "categories": readProductsJson.categories[userProductIndex]
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

    const user = readProductsJson.users.find(user => user.username === req.query.username);
    const userProductIndex = user.productSetIndex;

    try {

        // Check for valid query
        if (!req.query.id) {
            throw new Error("Request is missing an id value in query");
        }

        // Find product in database and handle not found
        const fetchedProduct = readProductsJson.products[userProductIndex].find(product => product.id == req.query.id);
        if (fetchedProduct) return res.status(401).send(`Product with that id is already in the list: ${JSON.stringify(fetchedProduct, null, 2)}`);

        // Push product to database and request barcode from api
        readProductsJson.products[userProductIndex].push(req.body);
        const barcodeImagePath = `${barcodeFolderDirectory}${req.body.id}.png`;
        const barcodeApiUrl = `https://barcodeapi.org/api/code128/`;

        // Check database for existing barcode image, fetch if missing
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
        console.error(err);
        return res.status(401).send(`Error was thrown: ${err}`);
    }
}

// Update existing item selected by id and data through req.body
async function updateProduct(req, res) {

    const user = readProductsJson.users.find(user => user.username === req.query.username);
    const userProductIndex = user.productSetIndex;

    try {

        // Check for valid query
        if (!req.query.id) {
            throw new Error("Request is missing an id value in query");
        }

        // Find product in database and handle not found
        const fetchedProduct = readProductsJson.products[userProductIndex].find((product) => product.id == req.query.id);
        if (!fetchedProduct) return res.status(401).send(`Product id ${req.query.id} not found in database`);

        // Define new product using provided data if applicable
        const updatedProduct = {
            "id": req.body.skuNum ? req.body.skuNum : fetchedProduct.id,
            "name": req.body.name ? req.body.name : fetchedProduct.name,
            "price": req.body.price ? req.body.price : fetchedProduct.price,
            "skuNum": req.body.skuNum ? req.body.skuNum : fetchedProduct.skuNum,
            "taxable": (req.body.taxable != fetchedProduct.taxable)? req.body.taxable : fetchedProduct.taxable,
            "fullPrice": req.body.fullPrice ? req.body.fullPrice : fetchedProduct.fullPrice,
            "category": req.body.category ? req.body.category : fetchedProduct.category
        };

        // Update product in database, sort in case of changes
        const targetIndex = readProductsJson.products[userProductIndex].indexOf(fetchedProduct);
        readProductsJson.products[userProductIndex][targetIndex] = updatedProduct;
        readProductsJson.products[userProductIndex].sort((a, b) => b.fullPrice - a.fullPrice);
        fs.writeFileSync(database, JSON.stringify(readProductsJson, null, 2));

        // Update barcode image if SKU was updated, query being new id and fetchedProduct being the old id
        if (req.query.skuNum && req.query.skuNum != fetchedProduct.id) {
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
        res.status(200).send(`Updated the following...\n${JSON.stringify(fetchedProduct, null, 2)}\nto...\n${JSON.stringify(updatedProduct, null, 2)}`);
    } catch (err) {
        console.error("Failed to update product", err);
        res.status(500).send("Interal server error");
    }
}

// Delete existing item and it's barcode image specified by id in req.query
async function deleteProduct (req, res) {

    try {

        // Check for id in query
        if (!req.query.id) {
            throw new Error("Request is missing an id value in the query");
        }

        // Get user's product list and get index of specified product
        const userSetIndex = readProductsJson.users.find(user => user.username === req.query.username).productSetIndex;
        const fetchedProductIndex = await readProductsJson.products[userSetIndex].findIndex((product) => product.id == req.query.id);

        if (fetchedProductIndex === -1) {
            return res.status(401).send(`Product id ${req.query.id} not found in database`);
        }

        // Remove product from database
        readProductsJson.products[userSetIndex].splice(fetchedProductIndex, 1);
        fs.writeFileSync(database, JSON.stringify(readProductsJson, null, 2));

        // Remove barcode image for the respective product
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

module.exports = {
    getAccess,
    getAllProducts,
    getProductById,
    getProductsByCategory,
    getRandomProducts,
    createProduct,
    updateProduct,
    deleteProduct
};