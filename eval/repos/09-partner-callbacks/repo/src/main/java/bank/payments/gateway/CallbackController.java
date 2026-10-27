package bank.payments.gateway;

import java.util.concurrent.TimeUnit;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
class CallbackController {
    private final Confirmations confirmations;

    CallbackController(Confirmations confirmations) {
        this.confirmations = confirmations;
    }

    /** A partner waits here until the payment is confirmed (from Kafka) or 30 seconds pass. */
    @GetMapping("/partners/{partner}/payments/{id}/confirmation")
    ResponseEntity<Confirmation> await(@PathVariable String partner, @PathVariable String id) throws Exception {
        try {
            return ResponseEntity.ok(confirmations.waitFor(id).get(30, TimeUnit.SECONDS));
        } catch (java.util.concurrent.TimeoutException e) {
            return ResponseEntity.noContent().build();
        }
    }
}
