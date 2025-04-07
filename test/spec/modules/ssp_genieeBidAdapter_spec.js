import { expect } from 'chai';
import { spec, BANNER_ENDPOINT, buildExtuidQuery } from 'modules/ssp_genieeBidAdapter.js';
import { config } from 'src/config.js';

const DEFAULT_BIDDER_REQUEST = {
  refererInfo: {
    legacy: { referer: 'https://example.com' },
    ref: 'https://example.com'
  }
};

describe('ssp_genieeBidAdapter', function () {
  const ZONE_ID = 1234567;
  const AD_UNIT_CODE = 'adunit-code';
  
  const BANNER_BID = {
    bidder: spec.code,
    params: { zoneId: ZONE_ID, invalidImpBeacon: false },
    adUnitCode: AD_UNIT_CODE,
    sizes: [[300, 250]],
    bidId: 'bidId12345',
    bidderRequestId: 'bidderRequestId12345',
    auctionId: 'auctionId12345',
  };

  const getGeparamsDefinedBid = (bid, params) => ({
    ...bid,
    params: { ...bid.params, geparams: params }
  });

  // 共通テストケース定義
  const TEST_CASES = {
    parameterValidation: [
      {
        type: 'geparams',
        params: [
          {param: 'zip', query: 'zip'},
          {param: 'country', query: 'country'},
          {param: 'city', query: 'city'},
          {param: 'long', query: 'long'},
          {param: 'lati', query: 'lati'},
          {param: 'gfuid', query: 'gfuid'},
          {param: 'adt', query: 'adt'}
        ]
      },
      {
        type: 'gecuparams',
        params: [
          {param: 'ver', query: 'gc_ver'},
          {param: 'minor', query: 'gc_minor'},
          {param: 'value', query: 'gc_value'}
        ]
      }
    ],
    currency: [
      { currency: undefined, expected: 'JPY', desc: 'default currency' },
      { currency: 'JPY', expected: 'JPY', desc: 'JPY specified' },
      { currency: 'USD', expected: 'USD', desc: 'USD specified' }
    ],
    adtk: [
      { value: 1, expected: '0', desc: 'truthy value' },
      { value: 0, expected: '1', desc: 'falsy value' }
    ],
    screenSize: [
      { width: 1440, height: 900, expected: {sw: 900, sh: 1440}, desc: 'landscape' },
      { width: 411, height: 731, expected: {sw: 411, sh: 731}, desc: 'portrait' }
    ],
    customParams: [
      { key: 'c1', value: undefined },
      { key: 'c2', value: null },
      { key: 'c3', value: '' },
      { key: 'c4', value: 'hoge' }
    ],
    extuid: [
      { 
        desc: 'only id5id exists', 
        setup: () => ({ userId: { id5id: { uid: 'id5id' } } }), 
        expected: 'id5:id5id' 
      },
      { 
        desc: 'no imuid cookie', 
        setup: () => sinon.stub(document, 'cookie').get(() => ''), 
        expected: null,
        teardown: stub => stub.restore()
      }
    ],
    gpid: [
      { 
        desc: 'gpid exists', 
        ext: { gpid: '/123/abc' }, 
        expected: '/123/abc' 
      },
      { 
        desc: 'pbadslot exists', 
        ext: { data: { pbadslot: '/456/def' } }, 
        expected: '/456/def' 
      },
      { 
        desc: 'both exist', 
        ext: { gpid: '/123/abc', data: { pbadslot: '/456/def' } }, 
        expected: '/123/abc' 
      },
      { 
        desc: 'neither exists', 
        ext: {}, 
        expected: undefined 
      }
    ]
  };

  beforeEach(function () {
    document.documentElement.innerHTML = '';
    document.body.appendChild(document.createElement('div')).id = AD_UNIT_CODE;
  });

  describe('Parameter Validation', function() {
    TEST_CASES.parameterValidation.forEach(({type, params}) => {
      describe(`${type} parameters`, function() {
        params.forEach(({param, query}) => {
          it(`handles ${param} correctly`, function() {
            const target = type === 'geparams' ? window.geparams = {} : window.gecuparams = {};
            [undefined, null, '', 'test'].forEach(value => {
              target[param] = value;
              const data = spec.buildRequests([BANNER_BID])[0].data;
              value && value !== '' 
                ? expect(data[query]).to.equal(value)
                : expect(data).to.not.have.property(query);
            });
          });
        });
      });
    });
  });

  describe('isBidRequestValid', function() {
    const CURRENCY_CONFIGS = [
      { config: null, expected: true, desc: 'no currency' },
      { config: { currency: { adServerCurrency: 'JPY' } }, expected: true, desc: 'JPY' },
      { config: { currency: { adServerCurrency: 'USD' } }, expected: true, desc: 'USD' },
      { config: { currency: { adServerCurrency: 'EUR' } }, expected: false, desc: 'invalid EUR' }
    ];

    CURRENCY_CONFIGS.forEach(({config: cfg, expected, desc}) => {
      it(`returns ${expected} for ${desc}`, function() {
        cfg ? config.setConfig(cfg) : config.resetConfig();
        expect(spec.isBidRequestValid(cfg ? 
          { ...BANNER_BID, params: { ...BANNER_BID.params } } : BANNER_BID
        )).to.equal(expected);
      });
    });

    afterEach(() => config.resetConfig());
  });

  describe('buildRequests', function() {
    describe('Core functionality', function() {
      it('uses correct endpoint', function() {
        expect(spec.buildRequests([BANNER_BID])[0].url).to.equal(BANNER_ENDPOINT);
      });

      it('includes bid in request', function() {
        expect(spec.buildRequests([BANNER_BID])[0].bid).to.equal(BANNER_BID);
      });
    });

    describe('Query Parameters', function() {
      it('sets zoneid correctly', function() {
        expect(spec.buildRequests([BANNER_BID])[0].data.zoneid).to.equal(ZONE_ID);
      });

      describe('Referer Handling', function() {
        it('uses bidderRequest referer when available', function() {
          const referer = 'https://example.com';
          const request = spec.buildRequests([BANNER_BID], {
            refererInfo: { legacy: { referer }, ref: referer }
          });
          expect(request[0].data.loc).to.equal(referer);
          expect(request[0].data.referer).to.equal(referer);
        });

        it('uses geparams when referer missing', function() {
          window.geparams = { loc: 'https://geo.com', ref: 'https://ref.com' };
          const request = spec.buildRequests([getGeparamsDefinedBid(BANNER_BID, {
            loc: 'geo', ref: 'ref'
          })]);
          expect(request[0].data.loc).to.equal(encodeURIComponent('geo'));
        });
      });

      // Parameterized Test Suites
      describe('Currency Handling', function() {
        TEST_CASES.currency.forEach(({ currency, expected, desc }) => {
          it(`handles ${desc}`, function() {
            const bid = currency ? 
              { ...BANNER_BID, params: { ...BANNER_BID.params, currency } } : BANNER_BID;
            expect(spec.buildRequests([bid])[0].data.cur).to.equal(expected);
          });
        });
      });

      describe('Invalid Impression Handling', function() {
        [true, false, undefined].forEach(value => {
          it(`handles ${value}`, function() {
            const bid = { ...BANNER_BID, params: { ...BANNER_BID.params, invalidImpBeacon: value } };
            expect(spec.buildRequests([bid])[0].data.ib).to.equal(0);
          });
        });
      });

      describe('Ad Tracking Key', function() {
        TEST_CASES.adtk.forEach(({ value, expected, desc }) => {
          it(`handles ${desc}`, function() {
            window.geparams = { lat: value };
            const request = spec.buildRequests([
              getGeparamsDefinedBid(BANNER_BID, { lat: value })
            ]);
            expect(request[0].data.adtk).to.equal(expected);
          });
        });
      });

      describe('Screen Dimensions', function() {
        TEST_CASES.screenSize.forEach(({ width, height, expected, desc }) => {
          it(`handles ${desc}`, function() {
            const stub = sinon.stub(window, 'screen').get(() => ({ width, height }));
            const data = spec.buildRequests([BANNER_BID])[0].data;
            expect(data.sw).to.equal(expected.sw);
            expect(data.sh).to.equal(expected.sh);
            stub.restore();
          });
        });
      });

      describe('Custom Parameters', function() {
        TEST_CASES.customParams.forEach(({ key, value }) => {
          it(`${value ? 'includes' : 'excludes'} custom_${key}`, function() {
            window.geparams = { custom: { [key]: value } };
            const data = spec.buildRequests([
              getGeparamsDefinedBid(BANNER_BID, { custom: { [key]: value } })
            ])[0].data;
            value ? expect(data[`custom_${key}`]).to.exist : expect(data).not.to.have.property(`custom_${key}`);
          });
        });
      });

      describe('User Identification', function() {
        TEST_CASES.extuid.forEach(({ desc, setup, expected, teardown }) => {
          it(`handles ${desc}`, function() {
            const setupResult = setup();
            const bid = setupResult?.userId ? { ...BANNER_BID, ...setupResult } : BANNER_BID;
            const data = spec.buildRequests([bid], DEFAULT_BIDDER_REQUEST)[0].data;
            
            expected 
              ? expect(data.extuid).to.include(encodeURIComponent(expected))
              : expect(data.extuid).to.be.undefined;

            teardown?.(setupResult);
          });
        });
      });

      describe('GPID Handling', function() {
        TEST_CASES.gpid.forEach(({ desc, ext, expected }) => {
          it(`handles ${desc}`, function() {
            const bid = { ...BANNER_BID, ortb2Imp: { ext } };
            const data = spec.buildRequests([bid])[0].data;
            expected ? expect(data.gpid).to.include(expected) : expect(data.gpid).to.be.undefined;
          });
        });
      });
    });
  });

  describe('interpretResponse', function() {
    const MOCK_RESPONSE = {
      [ZONE_ID]: {
        creativeId: 'creative123',
        cur: 'JPY',
        price: 0.1,
        width: 300,
        height: 250,
        requestid: 'req123',
        adm: '<div>Ad Content</div>'
      }
    };

    it('formats banner response correctly', function() {
      const request = spec.buildRequests([BANNER_BID])[0];
      const result = spec.interpretResponse({ body: MOCK_RESPONSE }, request)[0];
      
      expect(result).to.include({
        mediaType: 'banner',
        width: 300,
        height: 250,
        cpm: 0.1,
        ad: '<body marginwidth="0" marginheight="0"><div><script>window.addEventListener("load",function(){window.parent.document.getElementById("adunit-code").height=document.body.scrollHeight})</script><div>Ad Content</div></div></body>'
      });
    });
  });

  describe('buildExtuidQuery', function() {
    const TEST_CASES = [
      { 
        desc: 'id5 and imuid exist',
        input: { id5: 'id5_123', imuId: 'imuid_456' },
        expected: 'id5:id5_123\tim:imuid_456'
      },
      { 
        desc: 'only id5 exists',
        input: { id5: 'id5_123', imuId: null },
        expected: 'id5:id5_123'
      },
      { 
        desc: 'only imuid exists',
        input: { id5: null, imuId: 'imuid_456' },
        expected: 'im:imuid_456'
      },
      { 
        desc: 'no ids exist',
        input: { id5: null, imuId: null },
        expected: null
      },
      { 
        desc: 'empty strings',
        input: { id5: '', imuId: '' },
        expected: null
      }
    ];
  
    TEST_CASES.forEach(({ desc, input, expected }) => {
      it(`should handle ${desc}`, function() {
        expect(buildExtuidQuery(input)).to.equal(expected);
      });
    });
  
    describe('with cookie', function() {
      beforeEach(function() {
        sinon.stub(document, 'cookie').get(() => 'imuid=cookie_789');
      });
  
      afterEach(function() {
        sinon.restore();
      });
  
      it('should prioritize param over cookie', function() {
        const result = buildExtuidQuery({ id5: 'id5_123', imuId: 'param_456' });
        expect(result).to.equal('id5:id5_123\tim:param_456');
      });
  
      it('should use cookie when imuId not provided', function() {
        const result = buildExtuidQuery({ id5: 'id5_123', imuId: null });
        expect(result).to.equal('id5:id5_123\tim:cookie_789');
      });
    });
  });
});
