## Its final message

I added the `OrderShipped` function, but I haven't built or run it, so it's untested.

- **`OrderShipped.cs`** (new): a Service Bus trigger on the `orders-shipped` queue. It sends the SendGrid email and the Notification Hubs push in parallel, to fit the 2-second limit. If either send fails, the exception propagates and Service Bus retries the message.
- **`Program.cs`**: registers the SendGrid and Notification Hubs clients as singletons. Warm instances reuse their connections, which helps on the cold-start-heavy consumption plan.
- **`Orders.Functions.csproj`**: adds the `SendGrid` and `Microsoft.Azure.NotificationHubs` packages.

I stayed with .NET to match the rest of the repo. The 14 Oct note in `docs/team-notes.md` about moving new functions to Node or Go is marked "Not decided", so I didn't act on it.

The doc doesn't specify these, so I assumed them. Please check them:
- **Message shape:** JSON with `OrderId`, `CustomerEmail` and `CustomerId`.
- **Push targeting:** a template notification sent to the tag `customer:{CustomerId}`, with a `message` property.
- **App settings:** `SendGridApiKey`, `NotificationFromEmail`, `NotificationHubConnection` and `NotificationHubName`.
- **Email copy:** the subject and body are placeholder text.

At 200 per second on sale days, you may hit SendGrid rate limits or the consumption plan's scale-out limits. Cold starts could also push some notifications past 2 seconds. Setting a minimum instance count on a Premium plan would remove the cold-start risk, but that's a deployment decision for you.

## Files it changed

A  OrderShipped.cs
M  Orders.Functions.csproj
M  Program.cs

### OrderShipped.cs
```
using System.Text.Json;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.NotificationHubs;
using SendGrid;
using SendGrid.Helpers.Mail;

public record OrderShippedMessage(string OrderId, string CustomerEmail, string CustomerId);

public class OrderShipped
{
    private readonly ISendGridClient _sendGrid;
    private readonly INotificationHubClient _hub;

    public OrderShipped(ISendGridClient sendGrid, INotificationHubClient hub)
    {
        _sendGrid = sendGrid;
        _hub = hub;
    }

    [Function(nameof(OrderShipped))]
    public async Task Run([ServiceBusTrigger("orders-shipped", Connection = "ServiceBus")] string message)
    {
        var order = JsonSerializer.Deserialize<OrderShippedMessage>(message, JsonSerializerOptions.Web)
            ?? throw new InvalidOperationException("Empty order-shipped message.");

        var text = $"Your order {order.OrderId} has shipped.";

        var email = MailHelper.CreateSingleEmail(
            new EmailAddress(Environment.GetEnvironmentVariable("NotificationFromEmail")),
            new EmailAddress(order.CustomerEmail),
            "Your order has shipped",
            text,
            text);

        // Send both in parallel to stay inside the 2s budget. If either fails the exception
        // propagates, so Service Bus retries the message.
        await Task.WhenAll(
            _sendGrid.SendEmailAsync(email),
            _hub.SendTemplateNotificationAsync(
                new Dictionary<string, string> { ["message"] = text },
                $"customer:{order.CustomerId}"));
    }
}

```

### Orders.Functions.csproj
```
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <AzureFunctionsVersion>v4</AzureFunctionsVersion>
    <OutputType>Exe</OutputType>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.Azure.Functions.Worker" Version="1.23.0" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.Extensions.ServiceBus" Version="5.22.0" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.Sdk" Version="1.18.1" />
    <PackageReference Include="Microsoft.Azure.NotificationHubs" Version="4.2.0" />
    <PackageReference Include="SendGrid" Version="9.29.3" />
  </ItemGroup>
</Project>

```

### Program.cs
```
using Microsoft.Azure.NotificationHubs;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using SendGrid;

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults()
    .ConfigureServices(services =>
    {
        // Singletons so the HTTP connections are reused across invocations on a warm instance.
        services.AddSingleton<ISendGridClient>(_ =>
            new SendGridClient(Environment.GetEnvironmentVariable("SendGridApiKey")));
        services.AddSingleton<INotificationHubClient>(_ =>
            NotificationHubClient.CreateClientFromConnectionString(
                Environment.GetEnvironmentVariable("NotificationHubConnection"),
                Environment.GetEnvironmentVariable("NotificationHubName")));
    })
    .Build();
host.Run();

```
