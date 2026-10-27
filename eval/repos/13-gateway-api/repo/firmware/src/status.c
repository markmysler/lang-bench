#include "status.h"

/* Fills in the gateway's current status. Used by the radio stack and diagnostics. */
int gateway_status(struct gateway_status *out) {
    out->uptime_s = read_uptime();
    out->link_quality = radio_link_quality();
    return sensors_read(out->readings, MAX_SENSORS);
}
