const { createTapdChannel } = require("./tapd.cjs");
const { createManualChannel } = require("./manual.cjs");

class ChannelRegistry {
  constructor(channels) {
    this.channels = new Map();
    for (const channel of channels) {
      if (
        !/^[a-z][a-z0-9-]{0,31}$/.test(channel.id) ||
        this.channels.has(channel.id)
      )
        throw new Error("Invalid or duplicate channel ID.");
      for (const method of ["describe", "resolve", "prepare", "transition"])
        if (typeof channel[method] !== "function")
          throw new Error(`Channel ${channel.id} must implement ${method}.`);
      this.channels.set(channel.id, channel);
    }
  }
  get(id = "tapd") {
    const channel = this.channels.get(id);
    if (!channel) throw new Error(`未接入需求渠道：${id}`);
    return channel;
  }
  list() {
    return [...this.channels.values()].map((channel) => channel.describe());
  }
}
function defaultChannels(configFile, options) {
  return new ChannelRegistry([
    createTapdChannel(configFile),
    createManualChannel(configFile, options),
  ]);
}
module.exports = { ChannelRegistry, defaultChannels };
