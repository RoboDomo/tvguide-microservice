// TVGuide - manage TV channel information from schedulsdirect.org

process.env.DEBUG = "TVGuideHost,HostBase";
process.title = process.env.TITLE || "tvguide-microservice";

const debug = require("debug")("TVGuideHost"),
  console = require("console"),
  HostBase = require("microservice-core/HostBase"),
  request = require("superagent"),
  crypto = require("crypto"),
  USER_AGENT = "ha2",
  URL_BASE = "https://json.schedulesdirect.org/20141201/";

const POLL_TIME = 1000 * 60 * 60 * 24; // daily

// Settings/Configuration (from ENV vars)
const mqttHost = process.env.MQTT_HOST || "http://robodomo",
  topicRoot = process.env.TOPIC_ROOT || "tvguide",
  username = process.env.TVGUIDE_USERNAME,
  password = process.env.TVGUIDE_PASSWORD,
  country = process.env.TVGUIDE_COUNTRY || "USA",
  guideIds = process.env.TVGUIDE_IDS.split(",");

function channel(chan) {
  while (chan.length < 4) {
    chan = "0" + chan;
  }
  return chan;
}

class TVGuideHost extends HostBase {
  constructor(guideId) {
    super(mqttHost, topicRoot + "/" + guideId);
    debug(this.topic, "constructor");
    this.username = username;
    const generator = crypto.createHash("sha1");
    generator.update(password);
    this.password = generator.digest("hex");

    this.country = country;
    this.guideId = guideId;
    this.token = null;
    this.map = null;
    this.cld = `${this.country}-${this.guideId}-X`;

    this.poll();
  }

  async poll() {
    debug(this.device, "poll");
    while (1) {
      try {
        this.state = { channels: await this.getChannels() };
        await this.wait(POLL_TIME);
      } catch (e) {
        console.log(this.device, "poll exception", e);
        this.token = null;
        await this.wait(5000);
      }
    }
  }

  async getToken() {
    const uri = `${URL_BASE}token`;

    return new Promise((resolve, reject) => {
      request
        .post(uri)
        .send({ username: this.username, password: this.password })
        .set("User-Agent", USER_AGENT)
        .end((err, res) => {
          if (err) {
            reject(err.message);
          } else {
            debug("got token", res.body);
            this.token = res.body.token;
            resolve(res);
          }
        });
    });
  }

  async put(command) {
    if (!this.token) {
      Promise.reject("TVGuideHost: no token");
    }

    const uri = `${URL_BASE}${command}`;

    debug("put uri", uri);
    return new Promise((resolve, reject) => {
      request
        .put(uri)
        .set("token", this.token)
        .set("User-Agent", USER_AGENT)
        .end((err, res) => {
          if (err) {
            if (res) {
              reject(res.body);
            } else {
              reject(err.message);
            }
          } else {
            resolve(res.body);
          }
        });
    });
  }

  async get(command) {
    if (!this.token) {
      Promise.reject("TVGuideHost: no token");
    }

    const uri = `${URL_BASE}${command}`;

    debug("get uri", uri);
    return new Promise((resolve, reject) => {
      request
        .get(uri)
        .set("token", this.token)
        .set("User-Agent", USER_AGENT)
        .end((err, res) => {
          if (err) {
            if (res) {
              reject(res.body);
            } else {
              reject(err.message);
            }
          } else {
            resolve(res.body);
          }
        });
    });
  }

  async status() {
    return this.get("status");
  }

  async available() {
    return this.get("available");
  }

  async countries() {
    return this.get("available/countries");
  }

  async headends(country = COUNTRY, zip = ZIP) {
    return this.get(`headends?country=${country}&postalcode=${zip}`);
  }

  async subscribe(cld) {
    cld = cld || this.cld;

    try {
      return await this.put(`lineups/${cld}`);
    } catch (e) {
      debug("error subscribe", e);
    }
  }

  async channels(cld) {
    cld = cld || this.cld;
    return await this.get(`lineups/${cld}`);
  }

  makeChannelsMap(channels) {
    const stationIds = {};

    channels.stations.forEach(item => {
      stationIds[item.stationID] = item;
    });

    const map = {};
    channels.map.forEach(item => {
      const info = stationIds[item.stationID];

      try {
        // if (info.broadcastLanguage.indexOf('en') !== -1) { // } && Number(item.channel > 500)) {
        map[channel(item.channel)] = info;
        // }
      } catch (e) {
        console.log(
          this.device,
          "makeChannelsMap exception",
          e.message,
          e.stack
        );
        map[channel(item.channel)] = info;
      }
    });
    return map;
  }

  async getChannels() {
    return new Promise(async (resolve, reject) => {
      debug(this.device, "getChannels", this.guideId);
      if (!this.token) {
        await this.getToken();
      }

      try {
        await this.subscribe();
      } catch (e) {
        // may already be subscribed, ignore error
      }

      try {
        const channels = await this.channels();
        const stationIds = {};
        channels.stations.forEach(item => {
          stationIds[item.stationID] = item;
        });
        const map = {};
        channels.map.forEach(item => {
          const info = stationIds[item.stationID];

          try {
            // if (info.broadcastLanguage.indexOf('en') !== -1) { // } && Number(item.channel > 500)) {
            map[channel(item.channel)] = info;
            // }
          } catch (e) {
            console.log(
              this.device,
              "getChannels exception",
              e.message,
              e.stack
            );
            map[channel(item.channel)] = info;
          }
        });
        this.map = map;
        debug(this.device, "Got TV Guide");
        //        const newData = Object.assign(
        //          { _id: this.guideId, timestamp: new Date() },
        //          {
        //            channels: channels,
        //            mapped: this.map
        //          }
        //        );
        resolve(this.map);
        return this.map;
      } catch (e) {
        debug("getChannels error", e);
        this.token = null;
        reject(e);
      }
    });
  }
}

const guides = {};

guideIds.forEach(guideId => {
  guides[guideId] = new TVGuideHost(guideId);
});
