#!/bin/bash
cd "$(dirname "$0")"
echo "Downloading real product photos into assets/products..."
node scripts/download-product-photos.js
echo
echo "Done. Press Enter to close."
read
