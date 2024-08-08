# Overview

```
Module Name: Geniee Bid Adapter
Module Type: Bidder Adapter
Maintainer: supply-carpet@geniee.co.jp
```

# Description
This is [Geniee](https://geniee.co.jp) Bidder Adapter for Prebid.js.
(This is Geniee *SSP* Bidder Adapter. The another adapter named "Geniee Bid Adapter" is Geniee *DSP* Bidder Adapter.)

Please contact us before using the adapter.

We will provide ads when satisfy the following conditions:

- There are a certain number bid requests by zone
- The request is a Banner ad
- Payment is possible in Japanese yen or US dollars
- The request is not for GDPR or COPPA users

Thus, even if the following test, it will be no bids if the request does not reach a certain requests.

# Test Parameters

```js
var adUnits = [
    {
        code: 'banner-ad',
        mediaTypes: {
            banner: {
                sizes: [[300, 250], [728, 90]],
            }
        },
        bids: [
            {
                bidder: 'geniee',
                params: {
                    zoneId: 1234567, // required, integer
                    currency: 'JPY', // optional, JPY or USD is valid
                    geparams: {...}, // optional, object
                    gecuparams: {...}, // optional, object
                    isFillOnNoBid: true, // optional, boolean, write out the aladdin tag when not bid if true
                    invalidImpBeacon: true, // optional, boolean, invalid Impressions Beacon if true
                }
            }
        ]
    },
];
```

# Example page

```html
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Prebid</title>
    <script async src="prebid.js"></script>
    <script>
        var PREBID_TIMEOUT = 1000;

        var adUnitCodes = ['banner-ad']; // Please change accordingly
        var adUnits = [
            {
                code: adUnitCodes[0],
                mediaTypes: {
                    banner: {
                        sizes: [[300, 250], [728, 90]],
                    }
                },
                bids: [
                    {
                        bidder: 'geniee',
                        params: {
                            zoneId: 1234567,
                            currency: 'JPY',
                            isFillOnNoBid: true,
                        }
                    }
                ]
            },
        ];

        window.pbjs = window.pbjs || {};
        pbjs.que = pbjs.que || [];

        pbjs.que.push(function() {
            pbjs.setConfig({
                currency: {
                    adServerCurrency: "JPY",
                    defaultRates: { USD: { JPY: 120 } }
                }
            });
            pbjs.addAdUnits(adUnits);
            pbjs.requestBids({
                timeout: PREBID_TIMEOUT
            });
        });

        function renderAd() {
            for (var i = 0; i < adUnitCodes.length; i++) {
                var iframe = document.getElementById(adUnitCodes[i]);
                var bid = pbjs.getHighestCpmBids(adUnitCodes[i])[0];
                if (bid) pbjs.renderAd(iframe.contentWindow.document, bid.adId);
                else {
                    for (var j = 0; j < adUnits[i].bids.length; j++) {
                        if (adUnits[i].bids[j].bidder === 'geniee' && adUnits[i].bids[j].params.isFillOnNoBid) {
                            var zoneId = String(adUnits[i].bids[j].params.zoneId);
                            var src = "https://js.gsspcln.jp/t/" + zoneId.slice(1, 4) + "/" + zoneId.slice(4) + "/a" + zoneId + ".js";
                            iframe.contentWindow.document.write("<script type='text/javascript' src='" + src + "'></sc"
                            + "ript><script>window.addEventListener('load',function(){window.parent.document.getElementById('" + adUnitCodes[i] + "').height=document.body.scrollHeight})</sc" + "ript>");
                            break;
                        }
                    }
                }
            }
        }

        // Please call at the right time
        function refreshBid() {
            pbjs.que.push(function() {
                pbjs.requestBids({
                    timeout: PREBID_TIMEOUT,
                    adUnitCodes: adUnitCodes,
                    bidsBackHandler: function(bids) {
                        if (document.readyState !== "complete") {
                            window.addEventListener("DOMContentLoaded", renderAd, { once: true });
                        } else {
                            renderAd();
                        }
                    }
                });
            });
        }
    </script>
</head>
<body>
    <h1>Prebid</h1>
    <h5>Ad</h5>
    <iframe id="banner-ad" width="0" height="0" frameborder="0" scrolling="no" style="width: 100%;"></iframe> <!-- id is equal to adUnit code -->
    <iframe id="native-ad" width="0" height="0" frameborder="0" scrolling="no" style="width: 100%;"></iframe>
</body>
</html>
```
