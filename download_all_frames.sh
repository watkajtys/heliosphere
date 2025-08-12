#!/bin/bash
echo "Downloading 96 frames for solar time-lapse video..."

echo "Downloading frame 001 (2025-08-10T05:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-10T05%3A14%3A51.275Z" -o frames/frame_001.png

echo "Downloading frame 002 (2025-08-10T04:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-10T04%3A44%3A51.275Z" -o frames/frame_002.png

echo "Downloading frame 003 (2025-08-10T04:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-10T04%3A14%3A51.275Z" -o frames/frame_003.png

echo "Downloading frame 004 (2025-08-10T03:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-10T03%3A44%3A51.275Z" -o frames/frame_004.png

echo "Downloading frame 005 (2025-08-10T03:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-10T03%3A14%3A51.275Z" -o frames/frame_005.png

echo "Downloading frame 006 (2025-08-10T02:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-10T02%3A44%3A51.275Z" -o frames/frame_006.png

echo "Downloading frame 007 (2025-08-10T02:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-10T02%3A14%3A51.275Z" -o frames/frame_007.png

echo "Downloading frame 008 (2025-08-10T01:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-10T01%3A44%3A51.275Z" -o frames/frame_008.png

echo "Downloading frame 009 (2025-08-10T01:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-10T01%3A14%3A51.275Z" -o frames/frame_009.png

echo "Downloading frame 010 (2025-08-10T00:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-10T00%3A44%3A51.275Z" -o frames/frame_010.png
sleep 2

echo "Downloading frame 011 (2025-08-10T00:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-10T00%3A14%3A51.275Z" -o frames/frame_011.png

echo "Downloading frame 012 (2025-08-09T23:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T23%3A44%3A51.275Z" -o frames/frame_012.png

echo "Downloading frame 013 (2025-08-09T23:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T23%3A14%3A51.275Z" -o frames/frame_013.png

echo "Downloading frame 014 (2025-08-09T22:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T22%3A44%3A51.275Z" -o frames/frame_014.png

echo "Downloading frame 015 (2025-08-09T22:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T22%3A14%3A51.275Z" -o frames/frame_015.png

echo "Downloading frame 016 (2025-08-09T21:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T21%3A44%3A51.275Z" -o frames/frame_016.png

echo "Downloading frame 017 (2025-08-09T21:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T21%3A14%3A51.275Z" -o frames/frame_017.png

echo "Downloading frame 018 (2025-08-09T20:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T20%3A44%3A51.275Z" -o frames/frame_018.png

echo "Downloading frame 019 (2025-08-09T20:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T20%3A14%3A51.275Z" -o frames/frame_019.png

echo "Downloading frame 020 (2025-08-09T19:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T19%3A44%3A51.275Z" -o frames/frame_020.png
sleep 2

echo "Downloading frame 021 (2025-08-09T19:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T19%3A14%3A51.275Z" -o frames/frame_021.png

echo "Downloading frame 022 (2025-08-09T18:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T18%3A44%3A51.275Z" -o frames/frame_022.png

echo "Downloading frame 023 (2025-08-09T18:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T18%3A14%3A51.275Z" -o frames/frame_023.png

echo "Downloading frame 024 (2025-08-09T17:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T17%3A44%3A51.275Z" -o frames/frame_024.png

echo "Downloading frame 025 (2025-08-09T17:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T17%3A14%3A51.275Z" -o frames/frame_025.png

echo "Downloading frame 026 (2025-08-09T16:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T16%3A44%3A51.275Z" -o frames/frame_026.png

echo "Downloading frame 027 (2025-08-09T16:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T16%3A14%3A51.275Z" -o frames/frame_027.png

echo "Downloading frame 028 (2025-08-09T15:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T15%3A44%3A51.275Z" -o frames/frame_028.png

echo "Downloading frame 029 (2025-08-09T15:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T15%3A14%3A51.275Z" -o frames/frame_029.png

echo "Downloading frame 030 (2025-08-09T14:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T14%3A44%3A51.275Z" -o frames/frame_030.png
sleep 2

echo "Downloading frame 031 (2025-08-09T14:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T14%3A14%3A51.275Z" -o frames/frame_031.png

echo "Downloading frame 032 (2025-08-09T13:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T13%3A44%3A51.275Z" -o frames/frame_032.png

echo "Downloading frame 033 (2025-08-09T13:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T13%3A14%3A51.275Z" -o frames/frame_033.png

echo "Downloading frame 034 (2025-08-09T12:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T12%3A44%3A51.275Z" -o frames/frame_034.png

echo "Downloading frame 035 (2025-08-09T12:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T12%3A14%3A51.275Z" -o frames/frame_035.png

echo "Downloading frame 036 (2025-08-09T11:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T11%3A44%3A51.275Z" -o frames/frame_036.png

echo "Downloading frame 037 (2025-08-09T11:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T11%3A14%3A51.275Z" -o frames/frame_037.png

echo "Downloading frame 038 (2025-08-09T10:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T10%3A44%3A51.275Z" -o frames/frame_038.png

echo "Downloading frame 039 (2025-08-09T10:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T10%3A14%3A51.275Z" -o frames/frame_039.png

echo "Downloading frame 040 (2025-08-09T09:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T09%3A44%3A51.275Z" -o frames/frame_040.png
sleep 2

echo "Downloading frame 041 (2025-08-09T09:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T09%3A14%3A51.275Z" -o frames/frame_041.png

echo "Downloading frame 042 (2025-08-09T08:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T08%3A44%3A51.275Z" -o frames/frame_042.png

echo "Downloading frame 043 (2025-08-09T08:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T08%3A14%3A51.275Z" -o frames/frame_043.png

echo "Downloading frame 044 (2025-08-09T07:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T07%3A44%3A51.275Z" -o frames/frame_044.png

echo "Downloading frame 045 (2025-08-09T07:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T07%3A14%3A51.275Z" -o frames/frame_045.png

echo "Downloading frame 046 (2025-08-09T06:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T06%3A44%3A51.275Z" -o frames/frame_046.png

echo "Downloading frame 047 (2025-08-09T06:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T06%3A14%3A51.275Z" -o frames/frame_047.png

echo "Downloading frame 048 (2025-08-09T05:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T05%3A44%3A51.275Z" -o frames/frame_048.png

echo "Downloading frame 049 (2025-08-09T05:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T05%3A14%3A51.275Z" -o frames/frame_049.png

echo "Downloading frame 050 (2025-08-09T04:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T04%3A44%3A51.275Z" -o frames/frame_050.png
sleep 2

echo "Downloading frame 051 (2025-08-09T04:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T04%3A14%3A51.275Z" -o frames/frame_051.png

echo "Downloading frame 052 (2025-08-09T03:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T03%3A44%3A51.275Z" -o frames/frame_052.png

echo "Downloading frame 053 (2025-08-09T03:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T03%3A14%3A51.275Z" -o frames/frame_053.png

echo "Downloading frame 054 (2025-08-09T02:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T02%3A44%3A51.275Z" -o frames/frame_054.png

echo "Downloading frame 055 (2025-08-09T02:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T02%3A14%3A51.275Z" -o frames/frame_055.png

echo "Downloading frame 056 (2025-08-09T01:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T01%3A44%3A51.275Z" -o frames/frame_056.png

echo "Downloading frame 057 (2025-08-09T01:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T01%3A14%3A51.275Z" -o frames/frame_057.png

echo "Downloading frame 058 (2025-08-09T00:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T00%3A44%3A51.275Z" -o frames/frame_058.png

echo "Downloading frame 059 (2025-08-09T00:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-09T00%3A14%3A51.275Z" -o frames/frame_059.png

echo "Downloading frame 060 (2025-08-08T23:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T23%3A44%3A51.275Z" -o frames/frame_060.png
sleep 2

echo "Downloading frame 061 (2025-08-08T23:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T23%3A14%3A51.275Z" -o frames/frame_061.png

echo "Downloading frame 062 (2025-08-08T22:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T22%3A44%3A51.275Z" -o frames/frame_062.png

echo "Downloading frame 063 (2025-08-08T22:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T22%3A14%3A51.275Z" -o frames/frame_063.png

echo "Downloading frame 064 (2025-08-08T21:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T21%3A44%3A51.275Z" -o frames/frame_064.png

echo "Downloading frame 065 (2025-08-08T21:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T21%3A14%3A51.275Z" -o frames/frame_065.png

echo "Downloading frame 066 (2025-08-08T20:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T20%3A44%3A51.275Z" -o frames/frame_066.png

echo "Downloading frame 067 (2025-08-08T20:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T20%3A14%3A51.275Z" -o frames/frame_067.png

echo "Downloading frame 068 (2025-08-08T19:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T19%3A44%3A51.275Z" -o frames/frame_068.png

echo "Downloading frame 069 (2025-08-08T19:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T19%3A14%3A51.275Z" -o frames/frame_069.png

echo "Downloading frame 070 (2025-08-08T18:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T18%3A44%3A51.275Z" -o frames/frame_070.png
sleep 2

echo "Downloading frame 071 (2025-08-08T18:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T18%3A14%3A51.275Z" -o frames/frame_071.png

echo "Downloading frame 072 (2025-08-08T17:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T17%3A44%3A51.275Z" -o frames/frame_072.png

echo "Downloading frame 073 (2025-08-08T17:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T17%3A14%3A51.275Z" -o frames/frame_073.png

echo "Downloading frame 074 (2025-08-08T16:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T16%3A44%3A51.275Z" -o frames/frame_074.png

echo "Downloading frame 075 (2025-08-08T16:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T16%3A14%3A51.275Z" -o frames/frame_075.png

echo "Downloading frame 076 (2025-08-08T15:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T15%3A44%3A51.275Z" -o frames/frame_076.png

echo "Downloading frame 077 (2025-08-08T15:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T15%3A14%3A51.275Z" -o frames/frame_077.png

echo "Downloading frame 078 (2025-08-08T14:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T14%3A44%3A51.275Z" -o frames/frame_078.png

echo "Downloading frame 079 (2025-08-08T14:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T14%3A14%3A51.275Z" -o frames/frame_079.png

echo "Downloading frame 080 (2025-08-08T13:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T13%3A44%3A51.275Z" -o frames/frame_080.png
sleep 2

echo "Downloading frame 081 (2025-08-08T13:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T13%3A14%3A51.275Z" -o frames/frame_081.png

echo "Downloading frame 082 (2025-08-08T12:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T12%3A44%3A51.275Z" -o frames/frame_082.png

echo "Downloading frame 083 (2025-08-08T12:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T12%3A14%3A51.275Z" -o frames/frame_083.png

echo "Downloading frame 084 (2025-08-08T11:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T11%3A44%3A51.275Z" -o frames/frame_084.png

echo "Downloading frame 085 (2025-08-08T11:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T11%3A14%3A51.275Z" -o frames/frame_085.png

echo "Downloading frame 086 (2025-08-08T10:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T10%3A44%3A51.275Z" -o frames/frame_086.png

echo "Downloading frame 087 (2025-08-08T10:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T10%3A14%3A51.275Z" -o frames/frame_087.png

echo "Downloading frame 088 (2025-08-08T09:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T09%3A44%3A51.275Z" -o frames/frame_088.png

echo "Downloading frame 089 (2025-08-08T09:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T09%3A14%3A51.275Z" -o frames/frame_089.png

echo "Downloading frame 090 (2025-08-08T08:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T08%3A44%3A51.275Z" -o frames/frame_090.png
sleep 2

echo "Downloading frame 091 (2025-08-08T08:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T08%3A14%3A51.275Z" -o frames/frame_091.png

echo "Downloading frame 092 (2025-08-08T07:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T07%3A44%3A51.275Z" -o frames/frame_092.png

echo "Downloading frame 093 (2025-08-08T07:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T07%3A14%3A51.275Z" -o frames/frame_093.png

echo "Downloading frame 094 (2025-08-08T06:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T06%3A44%3A51.275Z" -o frames/frame_094.png

echo "Downloading frame 095 (2025-08-08T06:14:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T06%3A14%3A51.275Z" -o frames/frame_095.png

echo "Downloading frame 096 (2025-08-08T05:44:51.275Z)..."
curl -s "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-08T05%3A44%3A51.275Z" -o frames/frame_096.png

echo "All frames downloaded!"
ls -la frames/ | head -10
