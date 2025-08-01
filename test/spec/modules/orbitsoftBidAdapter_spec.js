import {expect} from 'chai';
import {spec} from 'modules/orbitsoftBidAdapter.js';

const ENDPOINT_URL = 'https://orbitsoft.com/php/ads/hb.phps';
const REFERRER_URL = 'http://referrer.url/?_=';

describe('Orbitsoft adapter', function () {
  describe('implementation', function () {
    describe('for requests', function () {
      it('should accept valid bid', function () {
        const validBid = {
          bidder: 'orbitsoft',
          params: {
            placementId: '123',
            requestUrl: ENDPOINT_URL
          }
        };
        const isValid = spec.isBidRequestValid(validBid);

        expect(isValid).to.equal(true);
      });

      it('should reject invalid bid', function () {
        const invalidBid = {
          bidder: 'orbitsoft'
        };
        const isValid = spec.isBidRequestValid(invalidBid);

        expect(isValid).to.equal(false);
      });
    });
    describe('for requests', function () {
      it('should accept valid bid with styles', function () {
        const validBid = {
          bidder: 'orbitsoft',
          params: {
            placementId: '123',
            requestUrl: ENDPOINT_URL,
            style: {
              title: {
                family: 'Tahoma',
                size: 'medium',
                weight: 'normal',
                style: 'normal',
                color: '0053F9'
              },
              description: {
                family: 'Tahoma',
                size: 'medium',
                weight: 'normal',
                style: 'normal',
                color: '0053F9'
              },
              url: {
                family: 'Tahoma',
                size: 'medium',
                weight: 'normal',
                style: 'normal',
                color: '0053F9'
              },
              colors: {
                background: 'ffffff',
                border: 'E0E0E0',
                link: '5B99FE'
              }
            }
          },
          refererInfo: {referer: REFERRER_URL},
        };
        const isValid = spec.isBidRequestValid(validBid);
        expect(isValid).to.equal(true);

        const buildRequest = spec.buildRequests([validBid])[0];
        const requestUrl = buildRequest.url;
        const requestUrlParams = buildRequest.data;
        expect(requestUrl).to.equal(ENDPOINT_URL);
        expect(requestUrlParams).have.property('f1', 'Tahoma');
        expect(requestUrlParams).have.property('fs1', 'medium');
        expect(requestUrlParams).have.property('w1', 'normal');
        expect(requestUrlParams).have.property('s1', 'normal');
        expect(requestUrlParams).have.property('c3', '0053F9');
        expect(requestUrlParams).have.property('f2', 'Tahoma');
        expect(requestUrlParams).have.property('fs2', 'medium');
        expect(requestUrlParams).have.property('w2', 'normal');
        expect(requestUrlParams).have.property('s2', 'normal');
        expect(requestUrlParams).have.property('c4', '0053F9');
        expect(requestUrlParams).have.property('f3', 'Tahoma');
        expect(requestUrlParams).have.property('fs3', 'medium');
        expect(requestUrlParams).have.property('w3', 'normal');
        expect(requestUrlParams).have.property('s3', 'normal');
        expect(requestUrlParams).have.property('c5', '0053F9');
        expect(requestUrlParams).have.property('c2', 'ffffff');
        expect(requestUrlParams).have.property('c1', 'E0E0E0');
        expect(requestUrlParams).have.property('c6', '5B99FE');
      });

      it('should accept valid bid with custom params', function () {
        const validBid = {
          bidder: 'orbitsoft',
          params: {
            placementId: '123',
            requestUrl: ENDPOINT_URL,
            customParams: {
              cacheBuster: 'bf4d7c1',
              clickUrl: 'http://testclickurl.com'
            }
          },
          refererInfo: {referer: REFERRER_URL},
        };
        const isValid = spec.isBidRequestValid(validBid);
        expect(isValid).to.equal(true);

        const buildRequest = spec.buildRequests([validBid])[0];
        const requestUrlCustomParams = buildRequest.data;
        expect(requestUrlCustomParams).have.property('c.cacheBuster', 'bf4d7c1');
        expect(requestUrlCustomParams).have.property('c.clickUrl', 'http://testclickurl.com');
      });

      it('should reject invalid bid without requestUrl', function () {
        const invalidBid = {
          bidder: 'orbitsoft',
          params: {
            placementId: '123'
          }
        };
        const isValid = spec.isBidRequestValid(invalidBid);

        expect(isValid).to.equal(false);
      });

      it('should reject invalid bid without placementId', function () {
        const invalidBid = {
          bidder: 'orbitsoft',
          params: {
            requestUrl: ENDPOINT_URL
          }
        };
        const isValid = spec.isBidRequestValid(invalidBid);

        expect(isValid).to.equal(false);
      });
    });
    describe('bid responses', function () {
      it('should return complete bid response', function () {
        const serverResponse = {
          body: {
            callback_uid: '265b29b70cc106',
            cpm: 0.5,
            width: 240,
            height: 240,
            content_url: 'https://orbitsoft.com/php/ads/hb.html',
            adomain: ['test.adomain.tld']
          }
        };

        const bidRequests = [
          {
            bidder: 'orbitsoft',
            params: {
              placementId: '123',
              requestUrl: ENDPOINT_URL
            }
          }
        ];
        const bids = spec.interpretResponse(serverResponse, {'bidRequest': bidRequests[0]});
        expect(bids).to.be.lengthOf(1);
        expect(bids[0].cpm).to.equal(serverResponse.body.cpm);
        expect(bids[0].width).to.equal(serverResponse.body.width);
        expect(bids[0].height).to.equal(serverResponse.body.height);
        expect(bids[0].currency).to.equal('USD');
        expect(bids[0].netRevenue).to.equal(true);
        expect(bids[0].adUrl).to.have.length.above(1);
        expect(bids[0].adUrl).to.have.string('https://orbitsoft.com/php/ads/hb.html');
        expect(Object.keys(bids[0].meta)).to.include.members(['advertiserDomains']);
        expect(bids[0].meta.advertiserDomains).to.deep.equal(serverResponse.body.adomain);
      });

      it('should return empty bid response', function () {
        const bidRequests = [
          {
            bidder: 'orbitsoft',
            params: {
              placementId: '123',
              requestUrl: ENDPOINT_URL
            }
          }
        ];
        const serverResponse = {
          body: {
            callback_uid: '265b29b70cc106',
            cpm: 0
          }
        };
        const bids = spec.interpretResponse(serverResponse, {'bidRequest': bidRequests[0]});

        expect(bids).to.be.lengthOf(0);
      });

      it('should return empty bid response on incorrect size', function () {
        const bidRequests = [
          {
            bidder: 'orbitsoft',
            params: {
              placementId: '123',
              requestUrl: ENDPOINT_URL
            }
          }
        ];
        const serverResponse = {
          body: {
            callback_uid: '265b29b70cc106',
            cpm: 1.5,
            width: 0,
            height: 0
          }
        };
        const bids = spec.interpretResponse(serverResponse, {'bidRequest': bidRequests[0]});

        expect(bids).to.be.lengthOf(0);
      });

      it('should return empty bid response with error', function () {
        const bidRequests = [
          {
            bidder: 'orbitsoft',
            params: {
              placementId: '123',
              requestUrl: ENDPOINT_URL
            }
          }
        ];
        const serverResponse = {error: 'error'};
        const bids = spec.interpretResponse(serverResponse, {'bidRequest': bidRequests[0]});

        expect(bids).to.be.lengthOf(0);
      });

      it('should return empty bid response on empty body', function () {
        const bidRequests = [
          {
            bidder: 'orbitsoft',
            params: {
              placementId: '123',
              requestUrl: ENDPOINT_URL
            }
          }
        ];
        const serverResponse = {};
        const bids = spec.interpretResponse(serverResponse, {'bidRequest': bidRequests[0]});

        expect(bids).to.be.lengthOf(0);
      });
    });
  });
});
