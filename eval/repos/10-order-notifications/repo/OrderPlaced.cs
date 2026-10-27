using Microsoft.Azure.Functions.Worker;

public class OrderPlaced
{
    [Function(nameof(OrderPlaced))]
    public void Run([ServiceBusTrigger("orders-placed", Connection = "ServiceBus")] string message)
    {
        // Reserve stock; see the stock service.
    }
}
