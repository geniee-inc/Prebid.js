import { expect } from 'chai';
import {
  spec,
  BANNER_ENDPOINT,
  buildExtuidQuery,
} from 'modules/ssp_genieeBidAdapter.js';
import { config } from 'src/config.js';

describe('ssp_genieeBidAdapter', function () {
  const ZONE_ID = 1234567;
  const AD_UNIT_CODE = 'adunit-code';
  const BANNER_BID = {
    bidder: spec.code,
    params: {
      zoneId: ZONE_ID,
      invalidImpBeacon: false,
    },
    adUnitCode: AD_UNIT_CODE,
    sizes: [[300, 250]],
    bidId: 'bidId12345',
    bidderRequestId: 'bidderRequestId12345',
    auctionId: 'auctionId12345',
  };

  function getGeparamsDefinedBid(bid, params) {
    const newBid = { ...bid };
    newBid.params.geparams = params;
    return newBid;
  }

  describe('Parameter Validation', function() {
    const testCases = [
      {
        type: 'geparams',
        params: [
          {param: 'zip', query: 'zip'},
          {param: 'country', query: 'country'},
          {param: 'city', query: 'city'},
          {param: 'long', query: 'long'},
          {param: 'lati', query: 'lati'}
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
    ];
  
    testCases.forEach(({type, params}) => {
      describe(`for ${type}`, function() {
        params.forEach(({param, query}) => {
          it(`should handle ${param} parameter correctly`, function() {
            const target = type === 'geparams' ? window.geparams : window.gecuparams;
            const testValues = [undefined, null, '', 'testValue'];
            
            testValues.forEach(value => {
              if (type === 'geparams') {
                window.geparams = {};
              } else {
                window.gecuparams = {};
              }
  
              target[param] = value;
  
              const request = spec.buildRequests([BANNER_BID]);
              const dataString = JSON.stringify(request[0].data);
  
              if (value && value !== '') {
                expect(dataString).to.include(`"${query}":"${value}"`);
              } else {
                expect(dataString).to.not.include(`"${query}":"`);
              }
            });
          });
        });
      });
    });
  });

  beforeEach(function () {
    document.documentElement.innerHTML = '';
    const adTagParent = document.createElement('div');
    adTagParent.id = AD_UNIT_CODE;
    document.body.appendChild(adTagParent);
  });

  describe('isBidRequestValid', function () {
    const currencyTestCases = [
      {
        description: 'no currency specified',
        config: null,
        expected: true
      },
      {
        description: 'valid JPY currency',
        config: { currency: { adServerCurrency: 'JPY' } },
        expected: true
      },
      {
        description: 'valid USD currency',
        config: { currency: { adServerCurrency: 'USD' } },
        expected: true
      },
      {
        description: 'invalid EUR currency',
        config: { currency: { adServerCurrency: 'EUR' } },
        expected: false
      }
    ];
  
    currencyTestCases.forEach(({ description, config, expected }) => {
      it(`should return ${expected} for ${description}`, function () {
        if (config) {
          config.setConfig(config);
        } else {
          config.resetConfig();
        }
        
        const bid = config ? 
          { ...BANNER_BID, params: { ...BANNER_BID.params } } :
          { ...BANNER_BID };
          
        expect(spec.isBidRequestValid(bid)).to.equal(expected);
      });
    });
  
    it('should return false when params.zoneId does not exist', function () {
      expect(spec.isBidRequestValid({ ...BANNER_BID, params: {} })).to.be.false;
    });
  
    afterEach(function () {
      config.resetConfig();
    });
  });

  describe('buildRequests', function () {
    it('should changes the endpoint with banner ads or naive ads', function () {
      const request = spec.buildRequests([BANNER_BID]);
      expect(request[0].url).to.equal(BANNER_ENDPOINT);
    });

    it('should return a ServerRequest where the bid is a bid for validBidRequests', function () {
      const request = spec.buildRequests([BANNER_BID]);
      expect(request[0].bid).to.equal(BANNER_BID);
    });

    describe('QueryStringParameters', function () {
      it('should sets the value of the zoneid query to bid.params.zoneId', function () {
        const request = spec.buildRequests([BANNER_BID]);
        expect(request[0].data.zoneid).to.deep.equal(BANNER_BID.params.zoneId);
      });

      it('should sets the values for loc and referer queries when bidderRequest.refererInfo.referer has a value', function () {
        const referer = 'https://example.com/';
        const request = spec.buildRequests([BANNER_BID], {
          refererInfo: { legacy: { referer: referer }, ref: referer },
        });
        expect(request[0].data.loc).to.deep.equal(referer);
        expect(request[0].data.referer).to.deep.equal(referer);
      });

      it('should makes the values of loc query and referer query geparams value when bidderRequest.refererInfo.referer is a falsy value', function () {
        const loc = 'https://www.google.com/';
        const referer = 'https://example.com/';
        window.geparams = {
          loc: 'https://www.google.com/',
          ref: 'https://example.com/',
        };
        const request = spec.buildRequests([
          getGeparamsDefinedBid(BANNER_BID, { loc: loc, ref: referer }),
        ]);
        expect(request[0].data.loc).to.deep.equal(encodeURIComponent(loc));
        expect(request[0].data.referer).to.deep.equal(encodeURIComponent(referer));
      });

      it('should sets the value of the ct0 query to geparams.ct0', function () {
        const ct0 = 'hoge';
        window.geparams = {
          ct0: 'hoge',
        };
        const request = spec.buildRequests([
          getGeparamsDefinedBid(BANNER_BID, { ct0: ct0 }),
        ]);
        expect(request[0].data.ct0).to.deep.equal(ct0);
      });

      it('should replaces currency with JPY if there is no currency provided', function () {
        const request = spec.buildRequests([BANNER_BID]);
        expect(request[0].data.cur).to.deep.equal('JPY');
      });

      it('should makes currency the value of params.currency when params.currency exists', function () {
        const request = spec.buildRequests([
          {
            ...BANNER_BID,
            params: { ...BANNER_BID.params, currency: 'JPY' },
          },
          {
            ...BANNER_BID,
            params: { ...BANNER_BID.params, currency: 'USD' },
          },
        ]);
        expect(request[0].data.cur).to.deep.equal('JPY');
        expect(request[1].data.cur).to.deep.equal('USD');
      });

      it('should makes invalidImpBeacon the value of params.invalidImpBeacon when params.invalidImpBeacon exists (in current version, this parameter is not necessary and ib is always `0`)', function () {
        const request = spec.buildRequests([
          {
            ...BANNER_BID,
            params: { ...BANNER_BID.params, invalidImpBeacon: true },
          },
          {
            ...BANNER_BID,
            params: { ...BANNER_BID.params, invalidImpBeacon: false },
          },
          {
            ...BANNER_BID,
            params: { ...BANNER_BID.params },
          },
        ]);
        expect(request[0].data.ib).to.deep.equal(0);
        expect(request[1].data.ib).to.deep.equal(0);
        expect(request[2].data.ib).to.deep.equal(0);
      });

      it('should not sets the value of the adtk query when geparams.lat does not exist', function () {
        const request = spec.buildRequests([BANNER_BID]);
        expect(request[0].data).to.not.have.property('adtk');
      });

      it('should sets the value of the adtk query to 0 when geparams.lat is truthy value', function () {
        window.geparams = {
          lat: 1,
        };
        const request = spec.buildRequests([
          getGeparamsDefinedBid(BANNER_BID, { lat: 1 }),
        ]);
        expect(request[0].data.adtk).to.deep.equal('0');
      });

      it('should sets the value of the adtk query to 1 when geparams.lat is falsy value', function () {
        window.geparams = {
          lat: 0,
        };
        const request = spec.buildRequests([
          getGeparamsDefinedBid(BANNER_BID, { lat: 0 }),
        ]);
        expect(request[0].data.adtk).to.deep.equal('1');
      });

      it('should sets the value of the idfa query to geparams.idfa', function () {
        const idfa = 'hoge';
        window.geparams = {
          idfa: 'hoge',
        };
        const request = spec.buildRequests([
          getGeparamsDefinedBid(BANNER_BID, { idfa: idfa }),
        ]);
        expect(request[0].data.idfa).to.deep.equal(idfa);
      });

      describe('Screen Size Parameters', function() {
        const testCases = [
          {
            description: 'landscape orientation',
            width: 1440,
            height: 900,
            expected: {sw: 900, sh: 1440}
          },
          {
            description: 'portrait orientation',
            width: 411,
            height: 731,
            expected: {sw: 411, sh: 731}
          }
        ];
      
        testCases.forEach(({description, width, height, expected}) => {
          it(`should handle ${description}`, function() {
            const stub = sinon.stub(window, 'screen').get(() => ({ width, height }));
            const request = spec.buildRequests([BANNER_BID]);
            
            expect(request[0].data.sw).to.equal(expected.sw);
            expect(request[0].data.sh).to.equal(expected.sh);
            
            stub.restore();
          });
        });
      });

      hasParamsNotBlankStringTestGeparams('zip', 'zip');
      hasParamsNotBlankStringTestGeparams('country', 'country');
      hasParamsNotBlankStringTestGeparams('city', 'city');
      hasParamsNotBlankStringTestGeparams('long', 'long');
      hasParamsNotBlankStringTestGeparams('lati', 'lati');

      it('should set the custom query to geparams.custom', function () {
        const params = {
          custom: {
            c1: undefined,
            c2: null,
            c3: '',
            c4: 'hoge',
          },
        };
        window.geparams = {
          custom: {
            c1: undefined,
            c2: null,
            c3: '',
            c4: 'hoge',
          },
        };
        const request = spec.buildRequests([
          getGeparamsDefinedBid(BANNER_BID, params),
        ]);
        expect(request[0].data).to.not.have.property('custom_c1');
        expect(request[0].data).to.not.have.property('custom_c2');
        expect(request[0].data).to.not.have.property('custom_c3');
        expect(request[0].data.custom_c4).to.have.string(
          `${params.custom.c4}`
        );
      });

      hasParamsNotBlankStringTestGecuparams('ver', 'gc_ver');
      hasParamsNotBlankStringTestGecuparams('minor', 'gc_minor');
      hasParamsNotBlankStringTestGecuparams('value', 'gc_value');

      it('should sets the value of the gfuid query to geparams.gfuid', function () {
        const gfuid = 'hoge';
        window.geparams = {
          gfuid: 'hoge',
        };
        const request = spec.buildRequests([
          getGeparamsDefinedBid(BANNER_BID, { gfuid: gfuid }),
        ]);
        expect(request[0].data).to.not.have.property('gfuid');
      });

      it('should sets the value of the adt query to geparams.adt', function () {
        const adt = 'hoge';
        window.geparams = {
          adt: 'hoge',
        };
        const request = spec.buildRequests([
          getGeparamsDefinedBid(BANNER_BID, { adt: adt }),
        ]);
        expect(request[0].data).to.not.have.property('adt');
      });

      it('should adds a query for naive ads and no query for banner ads', function () {
        // const query = '&tkf=1&ad_track=1&apiv=1.1.0';
        const query_apiv = '1.1.0';
        const query_tkf = '1';
        const query_ad_track = '1';
        const request = spec.buildRequests([BANNER_BID]);
        expect(String(request[0].data.apiv)).to.not.have.string(query_apiv);
        expect(String(request[0].data.tkf)).to.not.have.string(query_tkf);
        expect(String(request[0].data.ad_track)).to.not.have.string(query_ad_track);
      });

      it('should sets the value of the apid query to geparams.bundle when media type is banner', function () {
        const bundle = 'hoge';
        window.geparams = {
          bundle: 'hoge',
        };
        const request = spec.buildRequests([
          getGeparamsDefinedBid(BANNER_BID, { bundle: bundle }),
        ]);
        expect(request[0].data.apid).to.deep.equal(bundle);
      });

      it('should include only id5id in extuid query when only id5id exists', function () {
        const id5id = 'id5id';
        const request = spec.buildRequests([{...BANNER_BID, userId: {id5id: {uid: id5id}}}], DEFAULT_BIDDER_REQUEST);
        expect(request[0].data).to.have.string(
          `&extuid=${encodeURIComponent(`id5:${id5id}`)}`
        );
      });

      it('should not include the extuid query when it does not contain the imuid cookie', function () {
        const stub = sinon.stub(document, 'cookie').get(function () {
          return '';
        });
        const request = spec.buildRequests([BANNER_BID], DEFAULT_BIDDER_REQUEST);
        expect(request[0].data).to.not.have.string('&extuid=');
        stub.restore();
      });

      describe('buildExtuidQuery', function() {
        const testCases = [
          { id5: 'id1', imuId: 'imu1', expected: 'id5:id1\tim:imu1' },
          { id5: 'id1', imuId: null, expected: 'id5:id1' },
          { id5: null, imuId: 'imu1', expected: 'im:imu1' },
          { id5: null, imuId: null, expected: null }
        ];
      
        testCases.forEach(({ id5, imuId, expected }) => {
          it(`should return ${expected} for id5=${id5}, imuId=${imuId}`, function() {
            expect(buildExtuidQuery({ id5, imuId })).to.equal(expected);
          });
        });
      });

      it('should include gpid when ortb2Imp.ext.gpid exists', function () {
        const gpid = '/123/abc';
        const bidWithGpid = {
          ...BANNER_BID,
          ortb2Imp: {
            ext: {
              gpid: gpid
            }
          }
        };
        const request = spec.buildRequests([bidWithGpid]);
        expect(String(request[0].data.gpid)).to.have.string(gpid);
      });

      it('should include gpid when ortb2Imp.ext.data.pbadslot exists', function () {
        const pbadslot = '/123/abc';
        const bidWithPbadslot = {
          ...BANNER_BID,
          ortb2Imp: {
            ext: {
              data: {
                pbadslot: pbadslot
              }
            }
          }
        };
        const request = spec.buildRequests([bidWithPbadslot]);
        expect(String(request[0].data.gpid)).to.have.string(pbadslot);
      });

      it('should prioritize ortb2Imp.ext.gpid over ortb2Imp.ext.data.pbadslot', function () {
        const gpid = '/123/abc';
        const pbadslot = '/456/def';
        const bidWithBoth = {
          ...BANNER_BID,
          ortb2Imp: {
            ext: {
              gpid: gpid,
              data: {
                pbadslot: pbadslot
              }
            }
          }
        };
        const request = spec.buildRequests([bidWithBoth]);
        expect(String(request[0].data.gpid)).to.have.string(gpid);
      });

      it('should not include gpid when neither ortb2Imp.ext.gpid nor ortb2Imp.ext.data.pbadslot exists', function () {
        const request = spec.buildRequests([BANNER_BID]);
        expect(request[0].data).to.not.have.property('gpid');
      });
    });
  });

  describe('interpretResponse', function () {
    const response = {};
    response[ZONE_ID] = {
      creativeId: '<!-- CREATIVE ID -->',
      cur: 'JPY',
      price: 0.092,
      width: 300,
      height: 250,
      requestid: '2e42361a6172bf',
      adm: '<!-- ADS TAG -->',
    };
    const expected = {
      requestId: response[ZONE_ID].requestid,
      cpm: response[ZONE_ID].price,
      creativeId: response[ZONE_ID].creativeId,
      netRevenue: true,
      currency: 'JPY',
      ttl: 700,
      width: response[ZONE_ID].width,
      height: response[ZONE_ID].height,
    };

    it('should sets the response correctly when it comes to banner ads', function () {
      const expectedBanner = {
        ...expected,
        ad:
          '<body marginwidth="0" marginheight="0"><div><script>window.addEventListener("load",function(){window.parent.document.getElementById("' +
          BANNER_BID.adUnitCode +
          '").height=document.body.scrollHeight})</script>' +
          response[ZONE_ID].adm +
          '</div></body>',
        mediaType: 'banner',
      };
      const request = spec.buildRequests([BANNER_BID])[0];
      const result = spec.interpretResponse({ body: response }, request);
      expect(result[0]).to.deep.equal(expectedBanner);
    });
  });
});
