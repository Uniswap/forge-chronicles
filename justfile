# Fetch the latest chains.json from chainid.network
fetch-chains:
    #!/usr/bin/env bash
    echo "Fetching latest chains.json..."
    curl -s https://chainid.network/chains_mini.json > chains.json
    echo "Done! Updated chains.json"
