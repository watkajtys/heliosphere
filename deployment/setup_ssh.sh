#!/bin/bash
# Setup SSH key on Hetzner VPS

SSH_KEY="ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCi2sAeEETXwSuCRVc+MGz294sFMmfdTrA2NC+9ak9lcHghxG1lXycLonSY9CdAF3vvSlkHh1RjplunOFVuZieKF6ly+nPLklbCR5PJ56qxK4yoaKRORbkEh8MaWRhZcMveWVYV0Gr3Dlbg1tNdzP4hwSC2mTLBqbjg/RO2NzP9Al4lzOFD33choj93tMcvBpn7YRA8S5by3f+jPL8+qhS25CSPXPmSaA1zVqIFcujkU6CF4MUV6m9oFjsYLOffm+sJH7gt4yorIwRNj8VKZa8NBJwNbiHlh9Vwq+SZh8p2LCTSv2ID0pInK0VdDR73prRGdRafzmRyDnkm3EjBKKuU4Wd2wRHLEFTzWeG0XlZw1cf+MmuC/NOCoqviD8NjkRPZ9ChTf31juNOt5/eEMRmwjSri0eT2U8WtFAdUqhnfm9G1GcD3cXrD/UZEv4flZeW/0D0867ZSry0T/Fkh259oMNXY5UbMNu/SlaWqueXCTRJcQYEm2pHUZetbDzmDXFM= watka@DESKTOP-VUDL677"

echo "Setting up SSH key on server..."
echo "When prompted, enter password: Twad3xNWq4JX"
echo ""

ssh root@91.99.166.104 "mkdir -p ~/.ssh && echo '$SSH_KEY' >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys && echo 'SSH key installed successfully!'"

echo ""
echo "Testing passwordless connection..."
ssh root@91.99.166.104 "echo 'Success! SSH key authentication is working.'"