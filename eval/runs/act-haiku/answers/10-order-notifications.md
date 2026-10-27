## Its final message

I added the `orders-shipped` function, but I haven't built or run it. Running `dotnet` needs approval, and I didn't get it, so the code is checked by reading only.

**What changed**
- **`OrderShipped.cs`** (new): a Service Bus trigger on `orders-shipped`. It parses the message as JSON, then sends the SendGrid email and the Notification Hubs push in parallel with `Task.WhenAll`. That keeps the two calls inside the 2-second budget.
- **`Program.cs`**: registers the `SendGridClient` and `NotificationHubClient` as singletons. They're created once per worker instance, not per message, which matters at 200 messages/second.
- **`Orders.Functions.csproj`**: adds the `SendGrid` (9.29.3) and `Microsoft.Azure.NotificationHubs` (4.2.0) packages.

I haven't committed anything.

**Assumptions to confirm**
- **Message format.** The doc doesn't define the payload, so I assumed JSON with `OrderId`, `CustomerId` and `CustomerEmail`. If the warehouse sends something else, `ShippedOrder` needs to change.
- **Push delivery.** I used a template notification with a `message` property, tagged by `CustomerId`. This needs a matching template on each device registration. A native-platform send may be what you actually want.
- **Package versions.** I picked those versions from memory and didn't check them against NuGet. Run `dotnet build` to confirm they restore.
- **App settings.** The function needs `SendGridApiKey`, `SendGridFromAddress`, `NotificationHubConnectionString` and `NotificationHubName`. The `ServiceBus` connection setting is the same one `OrderPlaced` uses.

**Known gaps**
- **Retries can double-send.** If the email succeeds and the push fails, the exception makes Service Bus redeliver the message, and the customer gets the email again. Fixing that needs idempotency tracking, which I left out.
- **Cold starts aren't addressed in code.** The doc says instances often start cold on the consumption plan, and that can exceed 2 seconds on its own. Pre-warmed instances or a different plan would fix that, and that's your call.
- **Language.** `docs/team-notes.md` has an open suggestion to write new functions in Node or Go because of .NET start-up time. I kept this in C# to match the existing project.

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

public class OrderShipped
{
    private readonly SendGridClient _sendGrid;
    private readonly NotificationHubClient _hub;
    private readonly string _fromAddress;

    public OrderShipped(SendGridClient sendGrid, NotificationHubClient hub)
    {
        _sendGrid = sendGrid;
        _hub = hub;
        _fromAddress = Environment.GetEnvironmentVariable("SendGridFromAddress")
            ?? throw new InvalidOperationException("Missing app setting SendGridFromAddress.");
    }

    [Function(nameof(OrderShipped))]
    public async Task Run([ServiceBusTrigger("orders-shipped", Connection = "ServiceBus")] string message)
    {
        var order = JsonSerializer.Deserialize<ShippedOrder>(message)
            ?? throw new InvalidOperationException("Empty orders-shipped message.");

        // Send both in parallel to stay within the 2 second budget.
        await Task.WhenAll(SendEmailAsync(order), SendPushAsync(order));
    }

    private async Task SendEmailAsync(ShippedOrder order)
    {
        var mail = MailHelper.CreateSingleEmail(
            new EmailAddress(_fromAddress),
            new EmailAddress(order.CustomerEmail),
            "Your order has shipped",
            $"Good news: order {order.OrderId} has shipped.",
            null);

        await _sendGrid.SendEmailAsync(mail);
    }

    private async Task SendPushAsync(ShippedOrder order)
    {
        var properties = new Dictionary<string, string>
        {
            ["message"] = $"Order {order.OrderId} has shipped."
        };

        await _hub.SendTemplateNotificationAsync(properties, order.CustomerId);
    }
}

public record ShippedOrder(string OrderId, string CustomerId, string CustomerEmail);

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
        services.AddSingleton(_ => new SendGridClient(
            Environment.GetEnvironmentVariable("SendGridApiKey")
                ?? throw new InvalidOperationException("Missing app setting SendGridApiKey.")));

        services.AddSingleton(_ => NotificationHubClient.CreateClientFromConnectionString(
            Environment.GetEnvironmentVariable("NotificationHubConnectionString")
                ?? throw new InvalidOperationException("Missing app setting NotificationHubConnectionString."),
            Environment.GetEnvironmentVariable("NotificationHubName")
                ?? throw new InvalidOperationException("Missing app setting NotificationHubName.")));
    })
    .Build();
host.Run();

```
