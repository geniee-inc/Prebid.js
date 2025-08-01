import {
  getKeyValueTargetingPairs,
  auctionCallbacks,
  AUCTION_COMPLETED,
  adjustBids,
  getMediaTypeGranularity,
  getPriceByGranularity,
  addBidResponse, resetAuctionState, responsesReady, newAuction
} from 'src/auction.js';
import { EVENTS, TARGETING_KEYS, S2S } from 'src/constants.js';
import * as auctionModule from 'src/auction.js';
import { registerBidder } from 'src/adapters/bidderFactory.js';
import { createBid } from 'src/bidfactory.js';
import { config } from 'src/config.js';
import {_internal as store} from 'src/videoCache.js';
import * as ajaxLib from 'src/ajax.js';
import { server } from 'test/mocks/xhr.js';
import {hook} from '../../src/hook.js';
import {auctionManager} from '../../src/auctionManager.js';
import 'modules/debugging/index.js' // some tests look for debugging side effects
import {AuctionIndex} from '../../src/auctionIndex.js';
import {expect} from 'chai';
import {deepClone} from '../../src/utils.js';
import { IMAGE as ortbNativeRequest } from 'src/native.js';
import {PrebidServer} from '../../modules/prebidServerBidAdapter/index.js';
import { setConfig as setCurrencyConfig } from '../../modules/currency.js'

import { REJECTION_REASON } from '../../src/constants.js';
import { setDocumentHidden } from './unit/utils/focusTimeout_spec.js';
import {sandbox} from 'sinon';
import {getMinBidCacheTTL, onMinBidCacheTTLChange} from '../../src/bidTTL.js';
import {getGlobal} from '../../src/prebidGlobal.js';

/**
 * @typedef {import('../src/adapters/bidderFactory.js').BidRequest} BidRequest
 * @typedef {import('../src/adapters/bidderFactory.js').Bid} Bid
 */

var assert = require('assert');

/* use this method to test individual files instead of the whole prebid.js project */

// TODO refactor to use the spec files
var utils = require('../../src/utils.js');
var fixtures = require('../fixtures/fixtures.js');
var adapterManager = require('src/adapterManager').default;
var events = require('src/events');

const BIDDER_CODE = 'sampleBidder';
const BIDDER_CODE1 = 'sampleBidder1';

const ADUNIT_CODE = 'adUnit-code';
const ADUNIT_CODE1 = 'adUnit-code-1';

/**
 * @param {Object} [opts]
 * @returns {Bid}
 */
function mockBid(opts) {
  const bidderCode = opts && opts.bidderCode;

  return {
    adUnitCode: opts?.adUnitCode || ADUNIT_CODE,
    'ad': 'creative',
    'cpm': '1.99',
    'width': 300,
    'height': 250,
    'bidderCode': bidderCode || BIDDER_CODE,
    'requestId': utils.getUniqueIdentifierStr(),
    'transactionId': (opts && opts.transactionId) || ADUNIT_CODE,
    adUnitId: (opts && opts.adUnitId) || ADUNIT_CODE,
    'creativeId': 'id',
    'currency': 'USD',
    'netRevenue': true,
    'ttl': 360,
    getSize: () => '300x250',
    getIdentifiers() {
      return {
        src: this.source,
        bidder: this.bidderCode,
        bidId: this.requestId,
        transactionId: this.transactionId,
        auctionId: this.auctionId
      }
    },
    _ctx: {
      adUnits: opts?.adUnits,
      src: opts?.src,
      uniquePbsTid: opts?.uniquePbsTid,
    }
  };
}

/**
 * @param {Bid} bid
 * @param {Object} [opts]
 * @returns {BidRequest}
 */
function mockBidRequest(bid, opts) {
  if (!bid) {
    throw new Error('bid required');
  }
  const bidderCode = opts && opts.bidderCode;
  const adUnitCode = opts && opts.adUnitCode;
  const defaultMediaType = {
    banner: {
      sizes: [[300, 250], [300, 600]]
    }
  }
  const mediaType = (opts && opts.mediaType) ? opts.mediaType : defaultMediaType;

  const requestId = utils.getUniqueIdentifierStr();

  return {
    'bidderCode': bidderCode || bid.bidderCode,
    'auctionId': opts && opts.auctionId,
    'bidderRequestId': requestId,
    src: bid?._ctx?.src,
    adUnitsS2SCopy: bid?._ctx?.src === S2S.SRC ? bid?._ctx?.adUnits : undefined,
    uniquePbsTid: bid?._ctx?.src === S2S.SRC ? bid?._ctx?.uniquePbsTid : undefined,
    'bids': [
      {
        'bidder': bidderCode || bid.bidderCode,
        'params': {
          'placementId': 'id'
        },
        'adUnitCode': adUnitCode || ADUNIT_CODE,
        'transactionId': bid.transactionId,
        adUnitId: bid.adUnitId,
        'sizes': [[300, 250], [300, 600]],
        'bidId': bid.requestId,
        'bidderRequestId': requestId,
        'auctionId': opts && opts.auctionId,
        'mediaTypes': mediaType,
        src: bid?._ctx?.src
      }
    ],
    'auctionStart': 1505250713622,
    'timeout': 3000
  };
}

function mockBidder(bidderCode, bids) {
  const spec = {
    code: bidderCode,
    isBidRequestValid: sinon.stub(),
    buildRequests: sinon.stub(),
    interpretResponse: sinon.stub(),
    getUserSyncs: sinon.stub()
  };

  spec.buildRequests.returns([{'id': 123, 'method': 'POST'}]);
  spec.isBidRequestValid.returns(true);
  spec.interpretResponse.returns(bids);

  return spec;
}

const TEST_BIDS = [mockBid()];
const TEST_BID_REQS = TEST_BIDS.map(mockBidRequest);

function mockAjaxBuilder() {
  return function(url, callback) {
    const fakeResponse = sinon.stub();
    fakeResponse.returns('headerContent');
    callback.success('response body', { getResponseHeader: fakeResponse });
  };
}

describe('auctionmanager.js', function () {
  let indexAuctions, indexStub

  before(() => {
    // hooks are global and their side effects depend on what has been loaded
    [
      auctionModule.addBidResponse,
      auctionModule.addBidderRequests,
      auctionModule.bidsBackCallback
    ].forEach((h) => h.getHooks().remove())
    hook.ready();
  });

  beforeEach(() => {
    indexAuctions = [];
    indexStub = sinon.stub(auctionManager, 'index');
    indexStub.get(() => new AuctionIndex(() => indexAuctions));
    resetAuctionState();
  });

  afterEach(() => {
    indexStub.restore();
  });

  describe('getKeyValueTargetingPairs', function () {
    const DEFAULT_BID = {
      cpm: 5.578,
      pbLg: 5.50,
      pbMg: 5.50,
      pbHg: 5.57,
      pbAg: 5.50,

      height: 300,
      width: 250,
      getSize() {
        return this.height + 'x' + this.width;
      },

      adUnitCode: '12345',
      bidderCode: 'appnexus',
      adId: '1adId',
      source: 'client',
      mediaType: 'banner',
      creativeId: 'monkeys',
      meta: {
        advertiserDomains: ['adomain'],
        primaryCatId: 'IAB-test',
        networkId: '123987'
      }
    };

    /* return the expected response for a given bid, filter by keys if given */
    function getDefaultExpected(bid, keys) {
      var expected = {};
      expected[TARGETING_KEYS.BIDDER] = bid.bidderCode;
      expected[TARGETING_KEYS.AD_ID] = bid.adId;
      expected[TARGETING_KEYS.PRICE_BUCKET] = bid.pbMg;
      expected[TARGETING_KEYS.SIZE] = bid.getSize();
      expected[TARGETING_KEYS.SOURCE] = bid.source;
      expected[TARGETING_KEYS.FORMAT] = bid.mediaType;
      expected[TARGETING_KEYS.ADOMAIN] = bid.meta.advertiserDomains[0];
      expected[TARGETING_KEYS.ACAT] = bid.meta.primaryCatId;
      expected[TARGETING_KEYS.DSP] = bid.meta.networkId;
      expected[TARGETING_KEYS.CRID] = bid.creativeId;
      if (bid.mediaType === 'video') {
        expected[TARGETING_KEYS.UUID] = bid.videoCacheKey;
        expected[TARGETING_KEYS.CACHE_ID] = bid.videoCacheKey;
        expected[TARGETING_KEYS.CACHE_HOST] = 'test.cache.url';
      }
      if (!keys) {
        return expected;
      }

      return keys.reduce((map, key) => {
        map[key] = expected[key];
        return map;
      }, {});
    }

    var bid = {};

    before(function () {
      bid = Object.assign({}, DEFAULT_BID);
    });

    it('No bidder level configuration defined - default', function () {
      getGlobal().bidderSettings = {};
      const expected = getDefaultExpected(bid);
      // remove hb_cache_host from expected
      delete expected.hb_cache_host;
      const response = getKeyValueTargetingPairs(bid.bidderCode, bid);
      assert.deepEqual(response, expected);
    });

    it('should suppress acat if undefined', function () {
      const noAcatBid = deepClone(DEFAULT_BID);
      noAcatBid.meta.primaryCatId = ''
      const expected = getDefaultExpected(noAcatBid);
      delete expected.hb_acat;
      const response = getKeyValueTargetingPairs(noAcatBid.bidderCode, noAcatBid);
      assert.deepEqual(response, expected);
    });

    if (FEATURES.VIDEO) {
      it('No bidder level configuration defined - default for video', function () {
        config.setConfig({
          cache: {
            url: 'https://test.cache.url/endpoint'
          }
        });
        getGlobal().bidderSettings = {};
        const videoBid = utils.deepClone(bid);
        videoBid.mediaType = 'video';
        videoBid.videoCacheKey = 'abc123def';

        const expected = getDefaultExpected(videoBid);
        const response = getKeyValueTargetingPairs(videoBid.bidderCode, videoBid);
        assert.deepEqual(response, expected);
      });
    }

    it('Custom configuration for all bidders', function () {
      getGlobal().bidderSettings =
        {
          standard: {
            adserverTargeting: [
              {
                key: TARGETING_KEYS.BIDDER,
                val: function (bidResponse) {
                  return bidResponse.bidderCode;
                }
              }, {
                key: TARGETING_KEYS.AD_ID,
                val: function (bidResponse) {
                  return bidResponse.adId;
                }
              }, {
                key: TARGETING_KEYS.PRICE_BUCKET,
                val: function (bidResponse) {
                  // change default here
                  return bidResponse.pbHg;
                }
              }, {
                key: TARGETING_KEYS.SIZE,
                val: function (bidResponse) {
                  return bidResponse.size;
                }
              },
              {
                key: TARGETING_KEYS.SOURCE,
                val: function (bidResponse) {
                  return bidResponse.source;
                }
              },
              {
                key: TARGETING_KEYS.FORMAT,
                val: function (bidResponse) {
                  return bidResponse.mediaType;
                }
              },
              {
                key: TARGETING_KEYS.ADOMAIN,
                val: function (bidResponse) {
                  return bidResponse.meta.advertiserDomains[0];
                }
              },
              {
                key: TARGETING_KEYS.CRID,
                val: function (bidResponse) {
                  return bidResponse.creativeId;
                }
              },
              {
                key: TARGETING_KEYS.DSP,
                val: function (bidResponse) {
                  return bidResponse.meta.networkId;
                }
              },
              {
                key: TARGETING_KEYS.ACAT,
                val: function (bidResponse) {
                  return bidResponse.meta.primaryCatId;
                }
              }
            ]

          }
        };

      var expected = getDefaultExpected(bid);
      expected[TARGETING_KEYS.PRICE_BUCKET] = bid.pbHg;

      var response = getKeyValueTargetingPairs(bid.bidderCode, bid);
      assert.deepEqual(response, expected);
    });

    if (FEATURES.VIDEO) {
      it('Custom configuration for all bidders with video bid', function () {
        config.setConfig({
          cache: {
            url: 'https://test.cache.url/endpoint'
          }
        });
        const videoBid = utils.deepClone(bid);
        videoBid.mediaType = 'video';
        videoBid.videoCacheKey = 'abc123def';

        getGlobal().bidderSettings =
          {
            standard: {
              adserverTargeting: [
                {
                  key: TARGETING_KEYS.BIDDER,
                  val: function (bidResponse) {
                    return bidResponse.bidderCode;
                  }
                }, {
                  key: TARGETING_KEYS.AD_ID,
                  val: function (bidResponse) {
                    return bidResponse.adId;
                  }
                }, {
                  key: TARGETING_KEYS.PRICE_BUCKET,
                  val: function (bidResponse) {
                    return bidResponse.pbMg;
                  }
                }, {
                  key: TARGETING_KEYS.SIZE,
                  val: function (bidResponse) {
                    return bidResponse.size;
                  }
                },
                {
                  key: TARGETING_KEYS.SOURCE,
                  val: function (bidResponse) {
                    return bidResponse.source;
                  }
                },
                {
                  key: TARGETING_KEYS.FORMAT,
                  val: function (bidResponse) {
                    return bidResponse.mediaType;
                  }
                },
                {
                  key: TARGETING_KEYS.UUID,
                  val: function (bidResponse) {
                    return bidResponse.videoCacheKey;
                  }
                },
                {
                  key: TARGETING_KEYS.CACHE_ID,
                  val: function (bidResponse) {
                    return bidResponse.videoCacheKey;
                  }
                },
                {
                  key: TARGETING_KEYS.ADOMAIN,
                  val: function (bidResponse) {
                    return bidResponse.meta.advertiserDomains[0];
                  }
                },
                {
                  key: TARGETING_KEYS.CRID,
                  val: function (bidResponse) {
                    return bidResponse.creativeId;
                  }
                },
                {
                  key: TARGETING_KEYS.DSP,
                  val: function (bidResponse) {
                    return bidResponse.meta.networkId;
                  }
                },
                {
                  key: TARGETING_KEYS.ACAT,
                  val: function (bidResponse) {
                    return bidResponse.meta.primaryCatId;
                  }
                }
              ]

            }
          };

        const expected = getDefaultExpected(videoBid);

        const response = getKeyValueTargetingPairs(videoBid.bidderCode, videoBid);
        assert.deepEqual(response, expected);
      });
    }

    it('Custom configuration for one bidder', function () {
      getGlobal().bidderSettings =
        {
          appnexus: {
            adserverTargeting: [
              {
                key: TARGETING_KEYS.BIDDER,
                val: function (bidResponse) {
                  return bidResponse.bidderCode;
                }
              }, {
                key: TARGETING_KEYS.AD_ID,
                val: function (bidResponse) {
                  return bidResponse.adId;
                }
              }, {
                key: TARGETING_KEYS.PRICE_BUCKET,
                val: function (bidResponse) {
                  // change default here
                  return bidResponse.pbHg;
                }
              }, {
                key: TARGETING_KEYS.SIZE,
                val: function (bidResponse) {
                  return bidResponse.size;
                }
              }
            ]

          }
        };

      var expected = getDefaultExpected(bid);
      expected[TARGETING_KEYS.PRICE_BUCKET] = bid.pbHg;

      var response = getKeyValueTargetingPairs(bid.bidderCode, bid);
      assert.deepEqual(response, expected);
    });

    it('Custom configuration for one bidder - not matched', function () {
      getGlobal().bidderSettings =
        {
          nonExistentBidder: {
            adserverTargeting: [
              {
                key: TARGETING_KEYS.BIDDER,
                val: function (bidResponse) {
                  return bidResponse.bidderCode;
                }
              }, {
                key: TARGETING_KEYS.AD_ID,
                val: function (bidResponse) {
                  return bidResponse.adId;
                }
              }, {
                key: TARGETING_KEYS.PRICE_BUCKET,
                val: function (bidResponse) {
                  // change default here
                  return bidResponse.pbHg;
                }
              }, {
                key: TARGETING_KEYS.SIZE,
                val: function (bidResponse) {
                  return bidResponse.size;
                }
              }
            ]

          }
        };
      var expected = getDefaultExpected(bid);

      var response = getKeyValueTargetingPairs(bid.bidderCode, bid);
      assert.deepEqual(response, expected);
    });

    it('Should set targeting as expecting when pbs is enabled', function () {
      config.setConfig({
        s2sConfig: {
          accountId: '1',
          enabled: true,
          defaultVendor: 'appnexuspsp',
          bidders: ['appnexus'],
          timeout: 1000,
          adapter: 'prebidServer'
        }
      });

      getGlobal().bidderSettings = {};
      const expected = getDefaultExpected(bid);
      const response = getKeyValueTargetingPairs(bid.bidderCode, bid);
      assert.deepEqual(response, expected);
    });

    it('Custom bidCpmAdjustment for one bidder and inherit standard but doesn\'t use standard bidCpmAdjustment', function () {
      getGlobal().bidderSettings =
        {
          appnexus: {
            bidCpmAdjustment: function (bidCpm) {
              return bidCpm * 0.7;
            },
          },
          standard: {
            bidCpmAdjustment: function (bidCpm) {
              return 200;
            },
            adserverTargeting: [
              {
                key: TARGETING_KEYS.BIDDER,
                val: function (bidResponse) {
                  return bidResponse.bidderCode;
                }
              }, {
                key: TARGETING_KEYS.AD_ID,
                val: function (bidResponse) {
                  return bidResponse.adId;
                }
              }, {
                key: TARGETING_KEYS.PRICE_BUCKET,
                val: function (bidResponse) {
                  // change default here
                  return 10.00;
                }
              }
            ]

          }
        };
      var expected = getDefaultExpected(bid, [TARGETING_KEYS.BIDDER, TARGETING_KEYS.AD_ID]);
      expected[TARGETING_KEYS.PRICE_BUCKET] = 10.0;

      var response = getKeyValueTargetingPairs(bid.bidderCode, bid);
      assert.deepEqual(response, expected);
    });

    it('Standard bidCpmAdjustment changes the bid of any bidder', function () {
      const bid = Object.assign({},
        createBid(),
        fixtures.getBidResponses()[5]
      );

      assert.equal(bid.cpm, 0.5);

      getGlobal().bidderSettings =
        {
          standard: {
            bidCpmAdjustment: function (bidCpm) {
              return bidCpm * 0.5;
            }
          }
        };

      adjustBids(bid)
      assert.equal(bid.cpm, 0.25);
    });

    it('Custom bidCpmAdjustment AND custom configuration for one bidder and inherit standard settings', function () {
      getGlobal().bidderSettings =
        {
          appnexus: {
            bidCpmAdjustment: function (bidCpm) {
              return bidCpm * 0.7;
            },
            adserverTargeting: [
              {
                key: TARGETING_KEYS.BIDDER,
                val: function (bidResponse) {
                  return bidResponse.bidderCode;
                }
              }, {
                key: TARGETING_KEYS.AD_ID,
                val: function (bidResponse) {
                  return bidResponse.adId;
                }
              }, {
                key: TARGETING_KEYS.PRICE_BUCKET,
                val: function (bidResponse) {
                  // change default here
                  return 15.00;
                }
              }
            ]
          },
          standard: {
            adserverTargeting: [
              {
                key: TARGETING_KEYS.BIDDER,
                val: function (bidResponse) {
                  return bidResponse.bidderCode;
                }
              }, {
                key: TARGETING_KEYS.AD_ID,
                val: function (bidResponse) {
                  return bidResponse.adId;
                }
              }, {
                key: TARGETING_KEYS.PRICE_BUCKET,
                val: function (bidResponse) {
                  // change default here
                  return 10.00;
                },
              },
              {
                key: TARGETING_KEYS.SIZE,
                val: function (bidResponse) {
                  return bidResponse.size;
                }
              }
            ]

          }
        };
      var expected = getDefaultExpected(bid, [TARGETING_KEYS.BIDDER, TARGETING_KEYS.AD_ID, TARGETING_KEYS.SIZE]);
      expected[TARGETING_KEYS.PRICE_BUCKET] = 15.0;

      var response = getKeyValueTargetingPairs(bid.bidderCode, bid);
      assert.deepEqual(response, expected);
    });

    it('sendStandardTargeting=false, and inherit custom', function () {
      getGlobal().bidderSettings =
        {
          appnexus: {
            sendStandardTargeting: false,
            adserverTargeting: [
              {
                key: TARGETING_KEYS.BIDDER,
                val: function (bidResponse) {
                  return bidResponse.bidderCode;
                }
              }, {
                key: TARGETING_KEYS.AD_ID,
                val: function (bidResponse) {
                  return bidResponse.adId;
                }
              }, {
                key: TARGETING_KEYS.PRICE_BUCKET,
                val: function (bidResponse) {
                  return bidResponse.pbHg;
                }
              }
            ]
          }
        };
      var expected = getDefaultExpected(bid);
      expected[TARGETING_KEYS.PRICE_BUCKET] = 5.57;

      var response = getKeyValueTargetingPairs(bid.bidderCode, bid);
      assert.deepEqual(response, expected);
      assert.equal(bid.sendStandardTargeting, false);
    });

    it('suppressEmptyKeys=true', function() {
      getGlobal().bidderSettings =
        {
          standard: {
            suppressEmptyKeys: true,
            adserverTargeting: [
              {
                key: 'aKeyWithAValue',
                val: 42
              },
              {
                key: 'aKeyWithAnEmptyValue',
                val: ''
              }
            ]
          }
        };

      var expected = {
        'aKeyWithAValue': 42
      };

      var response = getKeyValueTargetingPairs(bid.bidderCode, bid);
      assert.deepEqual(response, expected);
    });
  });

  describe('adjustBids', function () {
    it('should adjust bids if greater than zero and pass copy of bid object', function () {
      const bid = Object.assign({},
        createBid(),
        fixtures.getBidResponses()[5]
      );

      assert.equal(bid.cpm, 0.5);

      getGlobal().bidderSettings =
        {
          brealtime: {
            bidCpmAdjustment: function (bidCpm, bidObj) {
              assert.deepEqual(bidObj, bid);
              if (bidObj.adUnitCode === 'negative') {
                return bidCpm * -0.5;
              }
              if (bidObj.adUnitCode === 'zero') {
                return 0;
              }
              return bidCpm * 0.5;
            },
          },
          standard: {
            adserverTargeting: [
            ]
          }
        };

      // negative
      bid.adUnitCode = 'negative';
      adjustBids(bid)
      assert.equal(bid.cpm, 0.5);

      // positive
      bid.adUnitCode = 'normal';
      adjustBids(bid)
      assert.equal(bid.cpm, 0.25);

      // zero
      bid.adUnitCode = 'zero';
      adjustBids(bid)
      assert.equal(bid.cpm, 0);

      // reset bidderSettings so we don't mess up further tests
      getGlobal().bidderSettings = {};
    });
  });

  describe('createAuction', () => {
    let adUnits, stubMakeBidRequests, stubCallAdapters, bids;

    beforeEach(() => {
      bids = [];
      stubMakeBidRequests = sinon.stub(adapterManager, 'makeBidRequests').returns([{
        bidderCode: BIDDER_CODE,
        bids: [{
          bidder: BIDDER_CODE
        }]
      }]);
      stubCallAdapters = sinon.stub(adapterManager, 'callBids').callsFake((au, reqs, addBid, done) => {
        bids.forEach(bid => addBid(bid.adUnitCode, bid));
        reqs.forEach(r => done.apply(r));
      });
      adUnits = [{
        code: ADUNIT_CODE,
        adUnitId: ADUNIT_CODE,
        bids: [
          {bidder: BIDDER_CODE},
        ]
      }];
    });

    afterEach(() => {
      stubMakeBidRequests.restore();
      stubCallAdapters.restore();
      auctionManager.clearAllAuctions();
    });

    it('passes global and bidder ortb2 to the auction', () => {
      const ortb2Fragments = {
        global: {},
        bidder: {}
      }
      const auction = auctionManager.createAuction({adUnits, ortb2Fragments});
      auction.callBids();
      const anyArgs = [...Array(7).keys()].map(() => sinon.match.any);
      sinon.assert.calledWith(stubMakeBidRequests, ...anyArgs.slice(0, 5).concat([sinon.match.same(ortb2Fragments)]));
      sinon.assert.calledWith(stubCallAdapters, ...anyArgs.slice(0, 7).concat([sinon.match.same(ortb2Fragments)]));
    });

    it('correctly adds nonbids when they are emitted', () => {
      const ortb2Fragments = {
        global: {},
        bidder: {}
      }
      const auction = auctionManager.createAuction({adUnits, ortb2Fragments});
      expect(auction.getNonBids()[0]).to.equal(undefined);
      events.emit(EVENTS.SEAT_NON_BID, {
        auctionId: auction.getAuctionId(),
        seatnonbid: ['test']
      });
      expect(auction.getNonBids()[0]).to.equal('test');
    });

    it('resolves .requestsDone', async () => {
      const auction = auctionManager.createAuction({adUnits});
      stubCallAdapters.resetHistory();
      auction.callBids();
      await auction.requestsDone;
    })

    describe('setConfig(minBidCacheTTL)', () => {
      it('should update getMinBidCacheTTL', () => {
        expect(getMinBidCacheTTL()).to.eql(null);
        config.setConfig({minBidCacheTTL: 123});
        expect(getMinBidCacheTTL()).to.eql(123);
      });

      it('should run listeners registered with onMinBidCacheTTLChange', () => {
        config.setConfig({minBidCacheTTL: 1});
        let newTTL = null;
        onMinBidCacheTTLChange((ttl) => { newTTL = ttl; });
        config.setConfig({minBidCacheTTL: 2});
        expect(newTTL).to.eql(2);
      })
    })

    describe('minBidCacheTTL', () => {
      let clock, auction;
      beforeEach(() => {
        clock = sinon.useFakeTimers();
        auction = auctionManager.createAuction({adUnits});
        indexAuctions.push(auction);
      });
      afterEach(() => {
        clock.restore();
        config.resetConfig();
      });

      describe('individual bids', () => {
        beforeEach(() => {
          bids = [
            {
              adUnitCode: ADUNIT_CODE,
              adUnitId: ADUNIT_CODE,
              ttl: 10
            }, {
              adUnitCode: ADUNIT_CODE,
              adUnitId: ADUNIT_CODE,
              ttl: 100
            }
          ];
        })
        it('are dropped when stale (if minBidCacheTTL is set)', async () => {
          config.setConfig({
            minBidCacheTTL: 30
          });
          auction.callBids();
          await auction.end;
          await clock.tick(20 * 1000);
          expect(auctionManager.getBidsReceived().length).to.equal(2);
          await clock.tick(50 * 1000);
          expect(auctionManager.getBidsReceived().length).to.equal(1);
        });

        it('pick up updates to minBidCacheTTL that happen during bid lifetime', async () => {
          auction.callBids();
          await auction.edn;
          clock.tick(10 * 1000);
          config.setConfig({
            minBidCacheTTL: 20
          })
          await clock.tick(0);
          await clock.tick(20 * 1000);
          expect(auctionManager.getBidsReceived().length).to.equal(1);
        })
      })

      describe('stale auctions', () => {
        it('are dropped after their last bid becomes stale (if minBidCacheTTL is set)', async () => {
          config.setConfig({
            minBidCacheTTL: 90
          });
          bids = [
            {
              adUnitCode: ADUNIT_CODE,
              adUnitId: ADUNIT_CODE,
              ttl: 10
            }, {
              adUnitCode: ADUNIT_CODE,
              adUnitId: ADUNIT_CODE,
              ttl: 100
            }
          ];
          auction.callBids();
          await auction.end;
          clock.tick(50 * 1000);
          expect(auctionManager.getBidsReceived().length).to.equal(2);
          clock.tick(56 * 1000);
          expect(auctionManager.getBidsReceived()).to.eql([]);
        });

        it('are dropped after `minBidCacheTTL` seconds if they had no bid', async () => {
          auction.callBids();
          config.setConfig({
            minBidCacheTTL: 2
          });
          await auction.end;
          await clock.tick(0);
          expect(auctionManager.getNoBids().length).to.eql(1);
          clock.tick(10 * 10000);
          expect(auctionManager.getNoBids().length).to.eql(0);
        });

        it('are not dropped after `minBidCacheTTL` seconds if the page was hidden', () => {
          auction.callBids();
          config.setConfig({
            minBidCacheTTL: 10
          });
          return auction.end.then(() => {
            expect(auctionManager.getNoBids().length).to.eql(1);
            setDocumentHidden(true);
            clock.tick(10 * 10000);
            setDocumentHidden(false);
            expect(auctionManager.getNoBids().length).to.eql(1);
          })
        });

        Object.entries({
          'bids': {
            bd: [{
              adUnitCode: ADUNIT_CODE,
              adUnitId: ADUNIT_CODE,
              ttl: 10
            }],
            entries: () => auctionManager.getBidsReceived()
          },
          'no bids': {
            bd: [],
            entries: () => auctionManager.getNoBids()
          }
        }).forEach(([t, {bd, entries}]) => {
          it(`with ${t} are never dropped if minBidCacheTTL is not set`, () => {
            bids = bd;
            auction.callBids();
            return auction.end.then(() => {
              clock.tick(100 * 1000);
              expect(entries().length > 0).to.be.true;
            })
          })
        });
      })
    })
  });

  describe('addBidResponse #1', function () {
    let createAuctionStub;
    let adUnits;
    let adUnitCodes;
    let spec;
    let auction;
    let ajaxStub;
    let bids;
    let bidderRequests;
    let makeRequestsStub;

    before(function () {
      makeRequestsStub = sinon.stub(adapterManager, 'makeBidRequests');
    });

    after(function () {
      adapterManager.makeBidRequests.restore();
    });

    describe('when auction timeout is 3000', function () {
      beforeEach(function () {
        ajaxStub = sinon.stub(ajaxLib, 'ajaxBuilder').callsFake(mockAjaxBuilder);
        adUnits = [{
          mediaTypes: {
            banner: {
              sizes: []
            }
          },
          code: ADUNIT_CODE,
          adUnitId: ADUNIT_CODE,
          bids: [
            {bidder: BIDDER_CODE, params: {placementId: 'id'}},
          ]
        }];
        adUnitCodes = [ADUNIT_CODE];
        auction = auctionModule.newAuction({adUnits, adUnitCodes, callback: function() {}, cbTimeout: 3000});
        bids = TEST_BIDS.slice();
        bidderRequests = bids.map(b => mockBidRequest(b, {auctionId: auction.getAuctionId()}));
        makeRequestsStub.returns(bidderRequests);
        indexAuctions = [auction];
        createAuctionStub = sinon.stub(auctionModule, 'newAuction');
        createAuctionStub.returns(auction);

        spec = mockBidder(BIDDER_CODE, bids);
        registerBidder(spec);
      });

      afterEach(function () {
        ajaxStub.restore();
        auctionModule.newAuction.restore();
      });

      function checkPbDg(cpm, expected, msg) {
        return function() {
          bids[0].cpm = cpm;
          auction.callBids();

          const registeredBid = auction.getBidsReceived().pop();
          assert.equal(registeredBid.pbDg, expected, msg);
        };
      };

      it('should return proper price bucket increments for dense mode when cpm is in range 0-3',
        checkPbDg('1.99', '1.99', '0 - 3 hits at to 1 cent increment'));

      it('should return proper price bucket increments for dense mode when cpm is in range 3-8',
        checkPbDg('4.39', '4.35', '3 - 8 hits at 5 cent increment'));

      it('should return proper price bucket increments for dense mode when cpm is in range 8-20',
        checkPbDg('19.99', '19.50', '8 - 20 hits at 50 cent increment'));

      it('should return proper price bucket increments for dense mode when cpm is 20+',
        checkPbDg('73.07', '20.00', '20+ caps at 20.00'));

      it('should place dealIds in adserver targeting', function () {
        bids[0].dealId = 'test deal';
        auction.callBids();

        const registeredBid = auction.getBidsReceived().pop();
        assert.equal(registeredBid.adserverTargeting[TARGETING_KEYS.DEAL], 'test deal', 'dealId placed in adserverTargeting');
      });

      it('should pass through default adserverTargeting sent from adapter', function () {
        bids[0].adserverTargeting = {};
        bids[0].adserverTargeting.extra = 'stuff';
        auction.callBids();

        const registeredBid = auction.getBidsReceived().pop();
        assert.equal(registeredBid.adserverTargeting[TARGETING_KEYS.BIDDER], BIDDER_CODE);
        assert.equal(registeredBid.adserverTargeting.extra, 'stuff');
      });
      it('should add the bidResponse to the collection before calling BID_RESPONSE', function () {
        let hasBid = false;
        const eventHandler = function(bid) {
          const storedBid = auction.getBidsReceived().pop();
          hasBid = storedBid === bid;
        }
        events.on(EVENTS.BID_RESPONSE, eventHandler);
        auction.callBids();
        events.off(EVENTS.BID_RESPONSE, eventHandler);
        assert.ok(hasBid, 'Bid not available');
      });

      describe('install publisher-defined renderers', () => {
        Object.entries({
          'on adUnit': () => adUnits[0],
          'on bid': () => bidderRequests[0].bids[0],
          'on mediatype': () => bidderRequests[0].bids[0].mediaTypes.banner,
        }).forEach(([t, getObj]) => {
          let renderer, bid;
          beforeEach(() => {
            renderer = {
              url: 'renderer.js',
              render: (bid) => bid
            };
          })

          function getBid() {
            const bid = Object.assign({},
              bids[0],
              {
                bidderCode: BIDDER_CODE,
                mediaType: 'banner',
              }
            );
            Object.assign(getObj(), {renderer});
            spec.interpretResponse.returns(bid);
            auction.callBids();
            return auction.getBidsReceived().pop();
          }

          it(t, () => {
            expect(getBid().renderer.url).to.eql('renderer.js');
          });

          it('allows renderers without URL', () => {
            delete renderer.url;
            expect(getBid().renderer.renderNow).to.be.true;
          });
        })
      })

      it('installs publisher-defined backup renderers on bids', function () {
        const renderer = {
          url: 'renderer.js',
          backupOnly: true,
          render: (bid) => bid
        };
        Object.assign(adUnits[0], {renderer});

        const bids1 = Object.assign({},
          bids[0],
          {
            bidderCode: BIDDER_CODE,
            mediaType: 'video-outstream',
          }
        );
        spec.interpretResponse.returns(bids1);
        auction.callBids();
        const addedBid = auction.getBidsReceived().pop();
        assert.equal(addedBid.renderer.url, 'renderer.js');
      });

      it('installs publisher-defined renderers for a media type', function () {
        const renderer = {
          url: 'videoRenderer.js',
          render: (bid) => bid
        };
        const myBid = mockBid();
        const bidRequest = mockBidRequest(myBid);

        bidRequest.bids[0] = {
          ...bidRequest.bids[0],
          mediaTypes: {
            banner: {
              sizes: [[300, 250], [300, 600]]
            },
            video: {
              context: 'outstream',
              renderer
            }
          }
        };
        makeRequestsStub.returns([bidRequest]);

        myBid.mediaType = 'video';
        spec.interpretResponse.returns(myBid);
        auction.callBids();

        const addedBid = auction.getBidsReceived().pop();
        assert.equal(addedBid.renderer.url, renderer.url);
      });

      it('installs bidder-defined renderer when onlyBackup is true in mediaTypes.video options ', function () {
        const renderer = {
          url: 'videoRenderer.js',
          backupOnly: true,
          render: (bid) => bid
        };
        const myBid = mockBid();
        const bidRequest = mockBidRequest(myBid);

        bidRequest.bids[0] = {
          ...bidRequest.bids[0],
          mediaTypes: {
            video: {
              context: 'outstream',
              renderer
            }
          }
        };
        makeRequestsStub.returns([bidRequest]);

        myBid.mediaType = 'video';
        myBid.renderer = {
          url: 'renderer.js',
          render: sinon.spy()
        };
        spec.interpretResponse.returns(myBid);
        auction.callBids();

        const addedBid = auction.getBidsReceived().pop();
        assert.strictEqual(addedBid.renderer.url, myBid.renderer.url);
      });

      describe('bid for a regular unit and a video unit', () => {
        beforeEach(() => {
          const renderer = {
            url: 'renderer.js',
            render: (bid) => bid
          };
          Object.assign(adUnits[0], {renderer});
          // make sure that if the renderer is only on the second ad unit, prebid
          // still correctly uses it
          const bid = mockBid();
          const bidRequests = [mockBidRequest(bid, {auctionId: auction.getAuctionId()})];

          bidRequests[0].bids[1] = Object.assign({
            bidId: utils.getUniqueIdentifierStr()
          }, bidRequests[0].bids[0]);
          Object.assign(bidRequests[0].bids[0], {
            adUnitCode: ADUNIT_CODE1,
            adUnitId: ADUNIT_CODE1,
          });

          makeRequestsStub.returns(bidRequests);

          // this should correspond with the second bid in the bidReq because of the ad unit code
          bid.mediaType = 'video-outstream';
          spec.interpretResponse.returns(bid);
        });

        it('should use renderers on bid response', () => {
          auction.callBids();

          const addedBid = auction.getBidsReceived().find(bid => bid.adUnitCode === ADUNIT_CODE);
          assert.equal(addedBid.renderer.url, 'renderer.js');
        });

        it('should resolve .end', () => {
          auction.callBids();
          return auction.end.then(() => {
            expect(auction.getBidsReceived().length).to.eql(1);
          })
        });
      })

      it('sets bidResponse.ttlBuffer from adUnit.ttlBuffer', () => {
        adUnits[0].ttlBuffer = 0;
        auction.callBids();
        expect(auction.getBidsReceived()[0].ttlBuffer).to.eql(0);
      });

      [
        {
          request: 1,
          response: true
        },
        {
          request: 0,
          response: false
        },
        {
          request: 2,
          response: false
        },
        {
          request: undefined,
          response: false
        }
      ].forEach(({request, response}) => {
        it(`sets bidResponse.instl to ${response} if adUnit.ortb2Imp.instl is ${request}`, () => {
          adUnits[0].ortb2Imp = {instl: request};
          auction.callBids();
          expect(auction.getBidsReceived()[0].instl).to.equal(response);
        })
      })
    });

    describe('when auction timeout is 20', function () {
      let eventsEmitSpy, auctionDone;

      function respondToRequest(requestIndex) {
        server.requests[requestIndex].respond(200, {}, 'response body');
      }

      function runAuction() {
        const bidRequests = bids.map(bid => mockBidRequest(bid, {auctionId: auction.getAuctionId()}));
        makeRequestsStub.returns(bidRequests);
        return new Promise((resolve) => {
          auctionDone = resolve;
          auction.callBids();
        })
      }

      beforeEach(function () {
        adUnits = [{
          code: ADUNIT_CODE,
          transactionId: ADUNIT_CODE,
          adUnitId: ADUNIT_CODE,
          bids: [
            {bidder: BIDDER_CODE, params: {placementId: 'id'}},
            {bidder: BIDDER_CODE1, params: {placementId: 'id'}},
          ]
        }];
        adUnitCodes = [ADUNIT_CODE];

        eventsEmitSpy = sinon.spy(events, 'emit');
        bids = [mockBid(), mockBid({ bidderCode: BIDDER_CODE1 })];
        const spec1 = mockBidder(BIDDER_CODE, [bids[0]]);
        registerBidder(spec1);
        const spec2 = mockBidder(BIDDER_CODE1, [bids[1]]);
        registerBidder(spec2);
        auction = auctionModule.newAuction({adUnits, adUnitCodes, callback: () => auctionDone(), cbTimeout: 20});
        indexAuctions = [auction];
      });

      afterEach(function () {
        events.emit.restore();
      });

      it('resolves .end on timeout', () => {
        let endResolved = false;
        auction.end.then(() => {
          endResolved = true;
        })
        const pm = runAuction().then(() => {
          expect(endResolved).to.be.true;
        });
        respondToRequest(0);
        return pm;
      });

      describe('AUCTION_TIMEOUT event', () => {
        let handler;
        beforeEach(() => {
          handler = sinon.spy();
          events.on(EVENTS.AUCTION_TIMEOUT, handler);
        })
        afterEach(() => {
          events.off(EVENTS.AUCTION_TIMEOUT, handler);
        });

        Object.entries({
          'is fired on timeout': [true, [0]],
          'is NOT fired otherwise': [false, [0, 1]],
        }).forEach(([t, [shouldFire, respond]]) => {
          it(t, () => {
            const pm = runAuction().then(() => {
              if (shouldFire) {
                sinon.assert.calledWith(handler, sinon.match({auctionId: auction.getAuctionId()}))
              } else {
                sinon.assert.notCalled(handler);
              }
            });
            respond.forEach(respondToRequest);
            return pm;
          })
        });
      });

      it('should emit BID_TIMEOUT and AUCTION_END for timed out bids', function () {
        const pm = runAuction().then(() => {
          const bidTimeoutCall = eventsEmitSpy.withArgs(EVENTS.BID_TIMEOUT).getCalls()[0];
          const timedOutBids = bidTimeoutCall.args[1];
          assert.equal(timedOutBids.length, 1);
          assert.equal(timedOutBids[0].bidder, BIDDER_CODE1);
          // Check that additional properties are available
          assert.equal(timedOutBids[0].params[0].placementId, 'id');

          const auctionEndCall = eventsEmitSpy.withArgs(EVENTS.AUCTION_END).getCalls()[0];
          const auctionProps = auctionEndCall.args[1];
          assert.equal(auctionProps.adUnits, adUnits);
          assert.equal(auctionProps.timeout, 20);
          assert.equal(auctionProps.auctionStatus, AUCTION_COMPLETED)
        });
        respondToRequest(0);
        return pm;
      });

      it('should NOT emit BID_TIMEOUT when all bidders responded in time', function () {
        const pm = runAuction().then(() => {
          assert.ok(eventsEmitSpy.withArgs(EVENTS.BID_TIMEOUT).notCalled, 'did not emit event BID_TIMEOUT');
        });
        respondToRequest(0);
        respondToRequest(1);
        return pm;
      });

      it('should NOT emit BID_TIMEOUT for bidders which responded in time but with an empty bid', function () {
        const pm = runAuction().then(() => {
          const bidTimeoutCall = eventsEmitSpy.withArgs(EVENTS.BID_TIMEOUT).getCalls()[0];
          const timedOutBids = bidTimeoutCall.args[1];
          assert.equal(timedOutBids.length, 1);
          assert.equal(timedOutBids[0].bidder, BIDDER_CODE1);
        });
        respondToRequest(0);
        return pm;
      });

      it('should NOT emit BID_TIMEOUT for bidders that replied through S2S', () => {
        adapterManager.registerBidAdapter(new PrebidServer(), 'pbs');
        config.setConfig({
          s2sConfig: [{
            accountId: '1',
            enabled: true,
            defaultVendor: 'appnexuspsp',
            bidders: ['mock-s2s-1'],
            adapter: 'pbs',
            endpoint: {
              p1Consent: 'https://ib.adnxs.com/openrtb2/prebid',
              noP1Consent: 'https://ib.adnxs-simple.com/openrtb2/prebid'
            },
            maxTimeout: 1000,
            syncEndpoint: {
              p1Consent: "https://prebid.adnxs.com/pbs/v1/cookie_sync",
              noP1Consent: "https://prebid.adnxs-simple.com/pbs/v1/cookie_sync"
            },
          }, {
            accountId: '1',
            enabled: true,
            defaultVendor: 'rubicon',
            bidders: ['mock-s2s-2'],
            adapter: 'pbs',
            endpoint: {
              p1Consent: 'https://prebid-server.rubiconproject.com/openrtb2/auction',
              noP1Consent: 'https://prebid-server.rubiconproject.com/openrtb2/auction',
            },
            maxTimeout: 500,
            syncEndpoint: {
              p1Consent: 'https://prebid-server.rubiconproject.com/cookie_sync',
              noP1Consent: 'https://prebid-server.rubiconproject.com/cookie_sync',
            },
          }]
        })
        adUnits[0].bids.push({bidder: 'mock-s2s-1'}, {bidder: 'mock-s2s-2'})
        const s2sAdUnits = deepClone(adUnits);
        bids.unshift(
          mockBid({ bidderCode: 'mock-s2s-1', src: S2S.SRC, adUnits: s2sAdUnits, uniquePbsTid: '1' }),
          mockBid({ bidderCode: 'mock-s2s-2', src: S2S.SRC, adUnits: s2sAdUnits, uniquePbsTid: '2' })
        );
        Object.assign(s2sAdUnits[0], {
          mediaTypes: {
            banner: {
              sizes: [[300, 250], [300, 600]]
            }
          },
          bids: [
            {
              bidder: 'mock-s2s-1',
              bid_id: bids[0].requestId
            },
            {
              bidder: 'mock-s2s-2',
              bid_id: bids[1].requestId
            }
          ]
        })

        const pm = runAuction().then(() => {
          const toBids = eventsEmitSpy.withArgs(EVENTS.BID_TIMEOUT).getCalls()[0].args[1]
          expect(toBids.map(bid => bid.bidder)).to.eql([
            'mock-s2s-2',
            BIDDER_CODE,
            BIDDER_CODE1,
          ])
        });
        respondToRequest(1);
        return pm;
      })
    });
  });

  describe('addBidResponse #2', function () {
    let createAuctionStub;
    let adUnits;
    let adUnitCodes;
    let spec;
    let spec1;
    let auction;
    let ajaxStub;

    const bids = TEST_BIDS;
    const bids1 = [mockBid({ bidderCode: BIDDER_CODE1 })];

    beforeEach(function () {
      adUnits = [{
        code: ADUNIT_CODE,
        transactionId: ADUNIT_CODE,
        adUnitId: ADUNIT_CODE,
        bids: [
          {bidder: BIDDER_CODE, params: {placementId: 'id'}},
        ]
      }, {
        code: ADUNIT_CODE1,
        transactionId: ADUNIT_CODE1,
        adUnitId: ADUNIT_CODE1,
        bids: [
          {bidder: BIDDER_CODE1, params: {placementId: 'id'}},
        ]
      }];
      adUnitCodes = adUnits.map(({ code }) => code);
      auction = auctionModule.newAuction({adUnits, adUnitCodes, callback: function() {}, cbTimeout: 3000});
      const bidRequests = [
        mockBidRequest(bids[0], { auctionId: auction.getAuctionId() }),
        mockBidRequest(bids1[0], { auctionId: auction.getAuctionId(), adUnitCode: ADUNIT_CODE1 })
      ];
      const makeRequestsStub = sinon.stub(adapterManager, 'makeBidRequests');
      makeRequestsStub.returns(bidRequests);
      ajaxStub = sinon.stub(ajaxLib, 'ajaxBuilder').callsFake(mockAjaxBuilder);
      createAuctionStub = sinon.stub(auctionModule, 'newAuction');
      createAuctionStub.returns(auction);
      indexAuctions = [auction];

      spec = mockBidder(BIDDER_CODE, bids);
      spec1 = mockBidder(BIDDER_CODE1, bids1);

      registerBidder(spec);
      registerBidder(spec1);
    });

    afterEach(function () {
      auctionModule.newAuction.restore();
      ajaxStub.restore();
      adapterManager.makeBidRequests.restore();
    });

    it('should not alter bid requestID', function () {
      auction.callBids();
      const bidsReceived = auction.getBidsReceived();
      const addedBid2 = bidsReceived.pop();
      assert.equal(addedBid2.requestId, bids1[0].requestId);
      const addedBid1 = bidsReceived.pop();
      assert.equal(addedBid1.requestId, bids[0].requestId);
    });

    it('should not add banner bids that have no width or height', function () {
      bids1[0].width = undefined;
      bids1[0].height = undefined;

      auction.callBids();

      const length = auction.getBidsReceived().length;
      const addedBid2 = auction.getBidsReceived().pop();
      assert.notEqual(addedBid2.adId, bids1[0].requestId);
      assert.equal(length, 1);
    });

    it('should run auction after video bids have been cached', async function () {
      sinon.stub(store, 'store').callsArgWith(1, null, [{uuid: 123}]);
      sinon.stub(config, 'getConfig').withArgs('cache.url').returns('cache-url');

      const bidsCopy = [Object.assign({}, bids[0], {mediaType: 'video'})];
      const bids1Copy = [Object.assign({}, bids1[0], {mediaType: 'video'})];

      spec.interpretResponse.returns(bidsCopy);
      spec1.interpretResponse.returns(bids1Copy);

      auction.callBids();
      await auction.end;

      assert.equal(auction.getBidsReceived().length, 2);
      assert.equal(auction.getAuctionStatus(), 'completed');

      config.getConfig.restore();
      store.store.restore();
    });

    it('runs auction after video responses with multiple bid objects have been cached', async function () {
      sinon.stub(store, 'store').callsArgWith(1, null, [{uuid: 123}]);
      sinon.stub(config, 'getConfig').withArgs('cache.url').returns('cache-url');

      const bidsCopy = [
        Object.assign({}, bids[0], {mediaType: 'video'}),
        Object.assign({}, bids[0], {mediaType: 'banner'}),
      ];
      const bids1Copy = [
        Object.assign({}, bids1[0], {mediaType: 'video'}),
        Object.assign({}, bids1[0], {mediaType: 'video'}),
      ];

      spec.interpretResponse.returns(bidsCopy);
      spec1.interpretResponse.returns(bids1Copy);

      auction.callBids();
      await auction.end;

      assert.equal(auction.getBidsReceived().length, 4);
      assert.equal(auction.getAuctionStatus(), 'completed');

      config.getConfig.restore();
      store.store.restore();
    });

    it('should reject bid for price higher than limit for the same currency', () => {
      sinon.stub(auction, 'addBidRejected');
      config.setConfig({
        maxBid: 1
      });

      auction.callBids();
      sinon.assert.calledWith(auction.addBidRejected, sinon.match({rejectionReason: REJECTION_REASON.PRICE_TOO_HIGH}));
    })
  });

  describe('addBidRequests', function () {
    let createAuctionStub;
    let adUnits;
    let adUnitCodes;
    let spec;
    let spec1;
    let auction;
    let ajaxStub;
    let logMessageStub;
    let logInfoStub;
    let logWarnStub;
    let logErrorStub;

    const bids = TEST_BIDS;
    const bids1 = [mockBid({ bidderCode: BIDDER_CODE1 })];

    before(function () {
      logMessageStub = sinon.stub(utils, 'logMessage');
      logInfoStub = sinon.stub(utils, 'logInfo');
      logWarnStub = sinon.stub(utils, 'logWarn');
      logErrorStub = sinon.stub(utils, 'logError');
    });

    after(function () {
      logMessageStub.restore();
      logInfoStub.restore();
      logWarnStub.restore();
      logErrorStub.restore();
    });

    beforeEach(function () {
      config.setConfig({
        debugging: {
          enabled: true,
          bidRequests: [{
            bidderCode: BIDDER_CODE,
            adUnitCode: ADUNIT_CODE
          }]
        }
      });

      adUnits = [{
        code: ADUNIT_CODE,
        transactionId: ADUNIT_CODE,
        bids: [
          {bidder: BIDDER_CODE, params: {placementId: 'id'}},
        ]
      }, {
        code: ADUNIT_CODE1,
        transactionId: ADUNIT_CODE1,
        bids: [
          {bidder: BIDDER_CODE1, params: {placementId: 'id'}},
        ]
      }];
      adUnitCodes = adUnits.map(({ code }) => code);
      auction = auctionModule.newAuction({adUnits, adUnitCodes, callback: function() {}, cbTimeout: 3000});
      createAuctionStub = sinon.stub(auctionModule, 'newAuction');
      createAuctionStub.returns(auction);
      indexAuctions = [auction];
      const bidRequests = [
        mockBidRequest(bids[0], { auctionId: auction.getAuctionId() }),
        mockBidRequest(bids1[0], { auctionId: auction.getAuctionId(), adUnitCode: ADUNIT_CODE1 })
      ];
      const makeRequestsStub = sinon.stub(adapterManager, 'makeBidRequests');
      makeRequestsStub.returns(bidRequests);

      ajaxStub = sinon.stub(ajaxLib, 'ajaxBuilder').callsFake(mockAjaxBuilder);

      spec = mockBidder(BIDDER_CODE, bids);
      spec1 = mockBidder(BIDDER_CODE1, bids1);

      registerBidder(spec);
      registerBidder(spec1);
    });

    afterEach(function () {
      logMessageStub.resetHistory();
      logInfoStub.resetHistory();
      logWarnStub.resetHistory();
      logErrorStub.resetHistory();
      auctionModule.newAuction.restore();
      ajaxStub.restore();
      adapterManager.makeBidRequests.restore();
      config.resetConfig();
    });

    it('should override bidRequest properties when config debugging has a matching bidRequest defined', function () {
      auction.callBids();
      const auctionBidRequests = auction.getBidRequests();
      assert.equal(auctionBidRequests.length > 0, true);
      assert.equal(Array.isArray(auctionBidRequests[0].bids), true);

      const bid = auctionBidRequests[0].bids.find(bid => bid.adUnitCode === ADUNIT_CODE);
      assert.equal(typeof bid !== 'undefined', true);
    });
  });

  if (FEATURES.NATIVE) {
    describe('addBidResponse native', function () {
      let makeRequestsStub;
      let ajaxStub;
      let spec;
      let auction;

      beforeEach(function () {
        makeRequestsStub = sinon.stub(adapterManager, 'makeBidRequests');
        ajaxStub = sinon.stub(ajaxLib, 'ajaxBuilder').callsFake(mockAjaxBuilder);

        const adUnits = [{
          code: ADUNIT_CODE,
          transactionId: ADUNIT_CODE,
          adUnitId: ADUNIT_CODE,
          bids: [
            {bidder: BIDDER_CODE, params: {placementId: 'id'}},
          ],
          nativeOrtbRequest: ortbNativeRequest.ortb,
          mediaTypes: { native: { type: 'image' } }
        }];
        auction = auctionModule.newAuction({adUnits, adUnitCodes: [ADUNIT_CODE], callback: function() {}, cbTimeout: 3000});
        indexAuctions = [auction];
        const createAuctionStub = sinon.stub(auctionModule, 'newAuction');
        createAuctionStub.returns(auction);

        spec = mockBidder(BIDDER_CODE);
        registerBidder(spec);
      });

      afterEach(function () {
        ajaxStub.restore();
        auctionModule.newAuction.restore();
        adapterManager.makeBidRequests.restore();
      });

      it('should add legacy fields to native response', function () {
        const nativeBid = mockBid();
        nativeBid.mediaType = 'native';
        nativeBid.native = {
          ortb: {
            ver: '1.2',
            assets: [
              { id: 2, title: { text: 'Sample title' } },
              { id: 4, data: { value: 'Sample body' } },
              { id: 3, data: { value: 'Sample sponsoredBy' } },
              { id: 1, img: { url: 'https://www.example.com/image.png', w: 200, h: 200 } },
              { id: 5, img: { url: 'https://www.example.com/icon.png', w: 32, h: 32 } }
            ],
            link: { url: 'http://www.click.com' },
            eventtrackers: [
              { event: 1, method: 1, url: 'http://www.imptracker.com' },
              { event: 1, method: 2, url: 'http://www.jstracker.com/file.js' }
            ]
          }
        }

        const bidRequest = mockBidRequest(nativeBid, { mediaType: { native: ortbNativeRequest } });
        makeRequestsStub.returns([bidRequest]);

        spec.interpretResponse.returns(nativeBid);
        auction.callBids();

        const addedBid = auction.getBidsReceived().pop();
        assert.equal(addedBid.native.body, 'Sample body')
        assert.equal(addedBid.native.title, 'Sample title')
        assert.equal(addedBid.native.sponsoredBy, 'Sample sponsoredBy')
        assert.equal(addedBid.native.clickUrl, 'http://www.click.com')
        assert.equal(addedBid.native.image.url, 'https://www.example.com/image.png')
        assert.equal(addedBid.native.icon.url, 'https://www.example.com/icon.png')
        assert.equal(addedBid.native.impressionTrackers[0], 'http://www.imptracker.com')
        assert.equal(addedBid.native.javascriptTrackers, '<script async src="http://www.jstracker.com/file.js"></script>')
      });
    });
  }

  describe('getMediaTypeGranularity', function () {
    if (FEATURES.VIDEO) {
      it('video', function () {
        let mediaTypes = { video: {id: '1'} };

        // mediaType is video and video.context is undefined
        expect(getMediaTypeGranularity('video', mediaTypes, {
          banner: 'low',
          video: 'medium'
        })).to.equal('medium');

        expect(getMediaTypeGranularity('video', {}, {
          banner: 'low',
          video: 'medium'
        })).to.equal('medium');
        expect(getMediaTypeGranularity('video', undefined, {
          banner: 'low',
          video: 'medium'
        })).to.equal('medium');

        // also when mediaTypes.video is undefined
        mediaTypes = { banner: {} };
        expect(getMediaTypeGranularity('video', mediaTypes, {
          banner: 'low',
          video: 'medium'
        })).to.equal('medium');

        // also when mediaTypes is undefined
        expect(getMediaTypeGranularity('video', {}, {
          banner: 'low',
          video: 'medium'
        })).to.equal('medium');
      });

      it('video-outstream', function () {
        const mediaTypes = { video: { context: 'outstream' } };

        expect(getMediaTypeGranularity('video', mediaTypes, {
          'banner': 'low', 'video': 'medium', 'video-outstream': 'high'
        })).to.equal('high');
      });

      it('video-instream', function () {
        const mediaTypes = { video: { context: 'instream' } };

        expect(getMediaTypeGranularity('video', mediaTypes, {
          banner: 'low', video: 'medium', 'video-instream': 'high'
        })).to.equal('high');

        // fall back to video if video-instream not found
        expect(getMediaTypeGranularity('video', mediaTypes, {
          banner: 'low', video: 'medium'
        })).to.equal('medium');

        expect(getMediaTypeGranularity('video', {mediaTypes: {banner: {}}}, {
          banner: 'low', video: 'medium'
        })).to.equal('medium');
      });
    }

    it('native', function () {
      expect(getMediaTypeGranularity('native', {native: {}}, {
        banner: 'low', video: 'medium', native: 'high'
      })).to.equal('high');
    });
  });

  describe('addWinningBid', () => {
    let auction, bid, adUnits, sandbox;
    beforeEach(() => {
      sandbox = sinon.createSandbox();
      sandbox.stub(adapterManager, 'callBidWonBidder');
      sandbox.stub(adapterManager, 'triggerBilling')
      adUnits = [{code: 'au1'}, {code: 'au2'}]
      auction = newAuction({adUnits});
      bid = {
        bidder: 'mock-bidder'
      };
    })
    afterEach(() => {
      sandbox.restore();
    });

    it('should call bidWon', () => {
      auction.addWinningBid(bid);
      sinon.assert.calledWith(adapterManager.callBidWonBidder, bid.bidder, bid, adUnits);
    });

    [undefined, false].forEach(deferBilling => {
      it(`should call onBidBillable if deferBilling = ${deferBilling}`, () => {
        bid.deferBilling = deferBilling;
        auction.addWinningBid(bid);
        sinon.assert.calledWith(adapterManager.triggerBilling, bid);
      });
    })

    it('should NOT call onBidBillable if deferBilling  = true', () => {
      bid.deferBilling = true;
      auction.addWinningBid(bid);
      sinon.assert.notCalled(adapterManager.triggerBilling);
    })
  })

  function mockAuction(getBidRequests, start = 1) {
    return {
      getBidRequests: getBidRequests,
      getAdUnits: () => getBidRequests().flatMap(br => br.bids).map(br => ({ code: br.adUnitCode, transactionId: br.transactionId, adUnitId: br.adUnitId, mediaTypes: br.mediaTypes })),
      getAuctionId: () => '1',
      addBidReceived: () => true,
      addBidRejected: () => true,
      getTimeout: () => 1000,
      getAuctionStart: () => start,
    }
  }

  describe('getPriceByGranularity', () => {
    beforeEach(() => {
      config.setConfig({
        mediaTypePriceGranularity: {
          video: 'medium',
          banner: 'low'
        }
      });
    })

    afterEach(() => {
      config.resetConfig();
    })

    it('evaluates undef granularity on each call', () => {
      const gpbg = getPriceByGranularity();
      expect(gpbg({
        mediaType: 'video', pbMg: 'medium'
      }, {
        'mediaTypes': {video: {id: '1'}}
      })).to.equal('medium');
      expect(gpbg({
        mediaType: 'banner',
        pbLg: 'low'
      }, {
        'mediaTypes': {banner: {}}
      })).to.equal('low');
    });
  })

  describe('auction options / callbacks', () => {
    let ready;
    function responsesReadyHook(next) {
      next(ready);
    }

    before(() => {
      responsesReady.before(responsesReadyHook, 100);
    });
    after(() => {
      responsesReady.getHooks({hook: responsesReadyHook}).remove();
    });

    beforeEach(() => {
      ready = Promise.resolve();
      return ready;
    });

    describe('auctionCallbacks', function() {
      const bids = TEST_BIDS;
      let bidRequests;
      let doneSpy;
      let auction;

      beforeEach(() => {
        const start = Date.now();
        auction = mockAuction(() => bidRequests, start);
        indexAuctions = [auction];
        doneSpy = sinon.spy();
        config.setConfig({
          cache: {
            url: 'https://test.cache.url/endpoint'
          }
        });
      });

      afterEach(() => {
        doneSpy.resetHistory();
        config.resetConfig();
        bidRequests = null;
      });

      Object.entries({
        'added to': (cbs) => cbs.addBidResponse,
        'rejected from': (cbs) => cbs.addBidResponse.reject,
      }).forEach(([t, getMethod]) => {
        it(`should call auction done after bid is ${t} auction for mediaType banner`, async function () {
          const ADUNIT_CODE2 = 'adUnitCode2';
          const BIDDER_CODE2 = 'sampleBidder2';

          const bids1 = [mockBid({bidderCode: BIDDER_CODE1, adUnitId: ADUNIT_CODE1})];
          const bids2 = [mockBid({bidderCode: BIDDER_CODE2, adUnitId: ADUNIT_CODE2})];
          bidRequests = [
            mockBidRequest(bids[0]),
            mockBidRequest(bids1[0], {adUnitCode: ADUNIT_CODE1}),
            mockBidRequest(bids2[0], {adUnitCode: ADUNIT_CODE2})
          ];
          const cbs = auctionCallbacks(doneSpy, auction);
          const method = getMethod(cbs);
          method(ADUNIT_CODE, bids[0]);
          cbs.adapterDone.call(bidRequests[0]);
          method(ADUNIT_CODE1, bids1[0]);
          cbs.adapterDone.call(bidRequests[1]);
          method(ADUNIT_CODE2, bids2[0]);
          cbs.adapterDone.call(bidRequests[2]);
          await ready;
          assert.equal(doneSpy.callCount, 1);
        });
      })

      if (FEATURES.VIDEO) {
        it('should call auction done after prebid cache is complete for mediaType video', async function () {
          bids[0].mediaType = 'video';
          const bids1 = [mockBid({bidderCode: BIDDER_CODE1})];

          const opts = {
            mediaType: {
              video: {
                context: 'instream',
                playerSize: [640, 480],
              },
            }
          };
          bidRequests = [
            mockBidRequest(bids[0], opts),
            mockBidRequest(bids1[0], {adUnitCode: ADUNIT_CODE1}),
          ];

          const cbs = auctionCallbacks(doneSpy, auction);
          cbs.addBidResponse.call(bidRequests[0], ADUNIT_CODE, bids[0]);
          cbs.adapterDone.call(bidRequests[0]);
          cbs.addBidResponse.call(bidRequests[1], ADUNIT_CODE1, bids1[0]);
          cbs.adapterDone.call(bidRequests[1]);
          await ready;
          assert.equal(doneSpy.callCount, 0);
          const uuid = 'c488b101-af3e-4a99-b538-00423e5a3371';
          const responseBody = `{"responses":[{"uuid":"${uuid}"}]}`;
          server.requests[0].respond(200, {'Content-Type': 'application/json'}, responseBody);
          assert.equal(doneSpy.callCount, 1);
        });
      }

      it('should convert cpm to number', () => {
        auction.addBidReceived = sinon.spy();
        const cbs = auctionCallbacks(doneSpy, auction);
        const bid = {...bids[0], cpm: '1.23'}
        bidRequests = [mockBidRequest(bid)];
        cbs.addBidResponse.call(bidRequests[0], ADUNIT_CODE, bid);
        sinon.assert.calledWith(auction.addBidReceived, sinon.match({cpm: 1.23}));
      })

      describe('when responsesReady defers', () => {
        let resolve, reject, promise, callbacks, bids;

        function hook(next, ready) {
          next(ready.then(() => promise));
        }

        before(() => {
          responsesReady.before(hook, 0); // higher priority than wrapping setup
        });

        after(() => {
          responsesReady.getHooks({hook}).remove();
        });

        beforeEach(() => {
          // eslint-disable-next-line promise/param-names
          promise = new Promise((rs, rj) => {
            resolve = rs;
            reject = rj;
          });
          bids = [
            mockBid({bidderCode: BIDDER_CODE1}),
            mockBid({bidderCode: BIDDER_CODE})
          ]
          bidRequests = bids.map((b) => mockBidRequest(b));
          callbacks = auctionCallbacks(doneSpy, auction);
          Object.assign(auction, {
            addNoBid: sinon.spy()
          });
        });

        Object.entries({
          'resolve': () => resolve(),
          'reject': () => reject(),
        }).forEach(([t, resolver]) => {
          it(`should wait for responsesReady to ${t} before calling auctionDone`, (done) => {
            bidRequests.forEach(bidRequest => callbacks.adapterDone.call(bidRequest));
            setTimeout(() => {
              sinon.assert.notCalled(doneSpy);
              resolver();
              setTimeout(() => {
                sinon.assert.called(doneSpy);
                done();
              })
            })
          });
        });
      });

      describe('when bids are rejected', () => {
        let cbs, bid, expectedRejection;
        const onBidRejected = sinon.stub();
        const REJECTION_REASON = 'Bid rejected';
        const AU_CODE = 'au';

        function rejectHook(fn, adUnitCode, bid, reject) {
          reject(REJECTION_REASON);
          reject(REJECTION_REASON); // second call should do nothing
        }

        before(() => {
          addBidResponse.before(rejectHook, 999);
          events.on(EVENTS.BID_REJECTED, onBidRejected);
        });

        after(() => {
          addBidResponse.getHooks({hook: rejectHook}).remove();
          events.off(EVENTS.BID_REJECTED, onBidRejected);
        });

        beforeEach(() => {
          onBidRejected.resetHistory();
          bid = mockBid({bidderCode: BIDDER_CODE});
          bidRequests = [
            mockBidRequest(bid),
          ];
          cbs = auctionCallbacks(doneSpy, auction);
          expectedRejection = sinon.match(Object.assign({}, bid, {
            cpm: parseFloat(bid.cpm),
            rejectionReason: REJECTION_REASON,
            adUnitCode: AU_CODE
          }));
          auction.addBidRejected = sinon.stub();
        });

        Object.entries({
          'with addBidResponse.reject': () => cbs.addBidResponse.reject(AU_CODE, deepClone(bid), REJECTION_REASON),
          'from addBidResponse hooks': () => cbs.addBidResponse(AU_CODE, deepClone(bid))
        }).forEach(([t, rejectBid]) => {
          describe(t, () => {
            it('should emit a BID_REJECTED event', () => {
              rejectBid();
              sinon.assert.calledWith(onBidRejected, expectedRejection);
            });

            it('should pass bid to auction.addBidRejected', () => {
              rejectBid();
              sinon.assert.calledWith(auction.addBidRejected, expectedRejection);
            });
          })
        });

        it('addBidResponse hooks should not be able to reject the same bid twice', () => {
          cbs.addBidResponse(AU_CODE, bid);
          expect(auction.addBidRejected.calledOnce).to.be.true;
        });
      })
    });
    describe('auctionOptions', function() {
      let bidRequests;
      let doneSpy;
      let clock;
      const requiredBidder = BIDDER_CODE;
      const requiredBidder1 = BIDDER_CODE1;
      const secondaryBidder = 'doNotWaitForMe';
      let auction;

      beforeEach(() => {
        clock = sinon.useFakeTimers();
        doneSpy = sinon.spy();
        config.setConfig({
          'auctionOptions': {
            secondaryBidders: [ secondaryBidder ]
          }
        });

        const start = Date.now();
        auction = mockAuction(() => bidRequests);
        indexAuctions = [auction];
      });

      afterEach(() => {
        doneSpy.resetHistory();
        config.resetConfig();
        clock.restore();
      });

      it('should not wait to call auction done for secondary bidders', async function () {
        const bids1 = [mockBid({bidderCode: requiredBidder, transactionId: ADUNIT_CODE1})];
        const bids2 = [mockBid({bidderCode: requiredBidder1, transactionId: ADUNIT_CODE1})];
        const bids3 = [mockBid({bidderCode: secondaryBidder, transactionId: ADUNIT_CODE1})];
        bidRequests = [
          mockBidRequest(bids1[0], {adUnitCode: ADUNIT_CODE1}),
          mockBidRequest(bids2[0], {adUnitCode: ADUNIT_CODE1}),
          mockBidRequest(bids3[0], {adUnitCode: ADUNIT_CODE1}),
        ];
        const cbs = auctionCallbacks(doneSpy, auction);
        // required bidder responds immeaditely to auction
        cbs.addBidResponse.call(bidRequests[0], ADUNIT_CODE1, bids1[0]);
        cbs.adapterDone.call(bidRequests[0]);
        await ready;
        assert.equal(doneSpy.callCount, 0);

        // auction waits for second required bidder to respond
        clock.tick(100);
        cbs.addBidResponse.call(bidRequests[1], ADUNIT_CODE1, bids2[0]);
        cbs.adapterDone.call(bidRequests[1]);
        // auction done is reported and does not wait for secondaryBidder request
        await ready;
        assert.equal(doneSpy.callCount, 1);

        cbs.addBidResponse.call(bidRequests[2], ADUNIT_CODE1, bids3[0]);
        cbs.adapterDone.call(bidRequests[2]);
      });

      it('should wait for all bidders if they are all secondary', async function () {
        config.setConfig({
          'auctionOptions': {
            secondaryBidders: [requiredBidder, requiredBidder1, secondaryBidder]
          }
        })
        const bids1 = [mockBid({bidderCode: requiredBidder})];
        const bids2 = [mockBid({bidderCode: requiredBidder1})];
        const bids3 = [mockBid({bidderCode: secondaryBidder})];
        bidRequests = [
          mockBidRequest(bids1[0], {adUnitCode: ADUNIT_CODE1}),
          mockBidRequest(bids2[0], {adUnitCode: ADUNIT_CODE1}),
          mockBidRequest(bids3[0], {adUnitCode: ADUNIT_CODE1}),
        ];
        const cbs = auctionCallbacks(doneSpy, auction);
        cbs.addBidResponse.call(bidRequests[0], ADUNIT_CODE1, bids1[0]);
        cbs.adapterDone.call(bidRequests[0]);
        clock.tick(100);
        await ready;
        assert.equal(doneSpy.callCount, 0)

        cbs.addBidResponse.call(bidRequests[1], ADUNIT_CODE1, bids2[0]);
        cbs.adapterDone.call(bidRequests[1]);
        clock.tick(100);
        await ready;
        assert.equal(doneSpy.callCount, 0);

        cbs.addBidResponse.call(bidRequests[2], ADUNIT_CODE1, bids3[0]);
        cbs.adapterDone.call(bidRequests[2]);
        await ready;
        assert.equal(doneSpy.callCount, 1);
      });

      it('should allow secondaryBidders to respond in auction before is is done', async function () {
        const bids1 = [mockBid({bidderCode: requiredBidder})];
        const bids2 = [mockBid({bidderCode: requiredBidder1})];
        const bids3 = [mockBid({bidderCode: secondaryBidder})];
        bidRequests = [
          mockBidRequest(bids1[0], {adUnitCode: ADUNIT_CODE1}),
          mockBidRequest(bids2[0], {adUnitCode: ADUNIT_CODE1}),
          mockBidRequest(bids3[0], {adUnitCode: ADUNIT_CODE1}),
        ];
        const cbs = auctionCallbacks(doneSpy, auction);
        // secondaryBidder is first to respond
        cbs.addBidResponse.call(bidRequests[2], ADUNIT_CODE1, bids3[0]);
        cbs.adapterDone.call(bidRequests[2]);
        clock.tick(100);
        await ready;
        assert.equal(doneSpy.callCount, 0);

        cbs.addBidResponse.call(bidRequests[1], ADUNIT_CODE1, bids2[0]);
        cbs.adapterDone.call(bidRequests[1]);
        clock.tick(100);
        await ready;
        assert.equal(doneSpy.callCount, 0);

        // first required bidder takes longest to respond, auction isn't marked as done until this occurs
        cbs.addBidResponse.call(bidRequests[0], ADUNIT_CODE1, bids1[0]);
        cbs.adapterDone.call(bidRequests[0]);
        await ready;
        assert.equal(doneSpy.callCount, 1);
      });
    });
  });
});
