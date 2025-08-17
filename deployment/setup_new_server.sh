#!/bin/bash
# Setup script for new Hetzner server

SERVER_IP="65.109.0.112"
SSH_KEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGa+vfQlKnOH2O6+WFy9z/0Tu18iENaA0aykSeWHltSF hetzner"

echo "Setting up SSH key on new server..."
echo "Password: AJtha7MkUjkFxV9c7qWC"
echo ""

# Try to set up SSH key
ssh root@${SERVER_IP} "mkdir -p ~/.ssh && echo '${SSH_KEY}' > ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys && echo 'SSH key installed!'"

echo "Testing connection..."
ssh -i C:/Users/watka/.ssh/id_ed25519_hetzner root@${SERVER_IP} "echo 'Success!'"